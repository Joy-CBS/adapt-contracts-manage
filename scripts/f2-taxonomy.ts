/**
 * F2-1 카테고리 체계 초안: F1 추출 결과를 Studio Chat에 넣어
 * "표준계약서 1종으로 묶을 수 있는 단위"의 유형 체계와 계약서별 배정을 받는다.
 *   npm run f2:taxonomy
 * 출력: data/f2/taxonomy.json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { StudioClient } from "@/lib/studio/client";
import { dataDir, loadState } from "@/lib/state";
import type { Category } from "@/lib/contracts";


const SCHEMA = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          class_key: { type: "string", description: "영문 소문자 snake_case 고유 키 (예: influencer_paid_post)" },
          name: { type: "string", description: "한국어 유형명 (예: 인플루언서 유료 협찬 계약)" },
          definition: { type: "string", description: "이 유형의 정의 한두 문장" },
          include_criteria: { type: "string", description: "이 유형에 포함되는 기준" },
          exclude_criteria: { type: "string", description: "비슷하지만 이 유형이 아닌 경우" },
          typical_clauses: { type: "array", items: { type: "string" }, description: "이 유형 표준계약서에 들어갈 핵심 조항 이름" },
          standardizable: { type: "boolean", description: "표준계약서 1종으로 정형화 가능한지" },
          standardizable_reason: { type: "string" },
          member_ids: { type: "array", items: { type: "integer" }, description: "이 유형에 속하는 계약서 번호" },
        },
        required: ["class_key", "name", "definition", "include_criteria", "exclude_criteria", "typical_clauses", "standardizable", "standardizable_reason", "member_ids"],
      },
    },
  },
  required: ["categories"],
};

const SYSTEM = `당신은 화장품·식품 브랜드 회사 어댑트(Adapt Inc.)의 법무팀을 돕는 계약 분류 전문가입니다.
목표: 법무팀이 "표준계약서" 한 종으로 관리할 수 있는 단위로 계약서를 그룹화합니다.
원칙:
- 같은 유형 = 같은 표준계약서 양식을 써도 되는 계약 (당사자 관계, 계약 목적, 핵심 의무·권리 구조가 같음).
- 언어(한국어/영어/중국어)와 브랜드, 금액, 국가 차이만으로는 유형을 나누지 않습니다. 같은 양식의 번역본으로 봅니다.
- 상대방이 개인 인플루언서인지 법인·에이전시인지, 업무가 SNS 게시인지 제작 용역인지 출연인지 유통인지처럼 조항 구조가 달라지는 차이로 나눕니다.
- 기존 계약을 변경·연장하는 부속 합의서는 별도 유형으로 둡니다.
- 유형은 8~15개 사이로 하고, 1~2건뿐인 희소 유형도 성격이 다르면 별도 유형으로 남기되 standardizable 판단을 함께 적습니다.
- 모든 계약서 번호는 정확히 한 유형에 배정합니다.
모든 설명은 한국어로 작성합니다.`;

async function main() {
  const state = loadState();
  const rows: string[] = [];
  const index: Array<{ id: number; sha256: string; path: string }> = [];
  let id = 0;
  for (const rec of Object.values(state.contracts)) {
    const f = path.join(dataDir(), "f1", "extract", `${rec.sha256}.json`);
    if (!fs.existsSync(f)) continue;
    const v = JSON.parse(fs.readFileSync(f, "utf8")).value ?? {};
    id++;
    index.push({ id, sha256: rec.sha256, path: rec.path });
    const short = (s: unknown, n = 140) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
    rows.push(
      [
        `#${id}`,
        `제목:${short(v.contract_title, 60)}`,
        `성격:${short(v.contract_type, 40)}`,
        `역할:${v.adapt_role}`,
        `상대방:${v.counterparty_type}`,
        `채널:${(v.channels ?? []).slice(0, 4).join("/")}`,
        `업무:${short(v.scope_summary)}`,
        `납품:${short(v.deliverables, 60)}`,
        `2차활용:${short(v.secondary_use_period, 40)}`,
      ].join(" | "),
    );
  }

  const studio = new StudioClient();
  const { text } = await studio.chat({
    system: SYSTEM,
    input: `아래는 어댑트 계약서 ${rows.length}건의 요약입니다. 유형 체계를 만들고 각 계약서를 배정하세요.\n\n${rows.join("\n")}`,
    jsonSchema: { name: "contract_taxonomy", schema: SCHEMA },
    reasoningEffort: "high",
  });
  const parsed = JSON.parse(text) as { categories: Category[] };

  // 배정 검증: 누락·중복
  const seen = new Map<number, string[]>();
  for (const c of parsed.categories) for (const m of c.member_ids) seen.set(m, [...(seen.get(m) ?? []), c.class_key]);
  const missing = index.filter((r) => !seen.has(r.id)).map((r) => r.id);
  const duplicated = [...seen.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);

  const out = path.join(dataDir(), "f2");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "taxonomy.json"), JSON.stringify({ index, ...parsed, missing, duplicated }, null, 1));
  for (const c of parsed.categories) {
    console.log(`${String(c.member_ids.length).padStart(4)}  ${c.class_key}  ${c.name}  ${c.standardizable ? "" : "(정형화 어려움)"}`);
  }
  console.log(`유형 ${parsed.categories.length}개, 누락 ${missing.length}건, 중복 ${duplicated.length}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
