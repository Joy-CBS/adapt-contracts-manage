/**
 * F2-3 표준안 후보: 유형마다 대표 계약서를 고르고, 대표 계약서 원문 + 같은 유형 계약서들의
 * 조항 편차를 Studio Chat에 넣어 임시 표준계약서(국문·영문 조항 + 가드레일)를 만든다.
 * 어댑트 25종 원본을 받으면 source=adapt_original로 교체한다.
 *
 *   npm run f2:templates [-- --only class_key]
 * 출력: data/f2/templates/<class_key>.json, data/f2/coverage.json
 */
import "dotenv/config";
import { StudioClient } from "@/lib/studio/client";
import {
  type Category,
  type StandardTemplate,
  exists,
  extracted,
  parseText,
  pmap,
  readJson,
  writeJson,
} from "@/lib/contracts";

type Taxonomy = { index: Array<{ id: number; sha256: string; path: string }>; categories: Category[] };

const LEGAL_FIELDS = [
  "ip_ownership", "portrait_rights", "exclusivity", "confidentiality",
  "penalty_damages", "termination", "governing_law_dispute",
] as const;

export const TEMPLATE_SCHEMA = {
  type: "object",
  properties: {
    title_ko: { type: "string" },
    title_en: { type: "string" },
    preamble_ko: { type: "string", description: "전문(당사자·목적). 가변 값은 [상대방], [브랜드], [계약일] 같은 대괄호 자리표시자" },
    preamble_en: { type: "string" },
    clauses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          no: { type: "integer" },
          title_ko: { type: "string" },
          title_en: { type: "string" },
          text_ko: { type: "string", description: "조항 전문(국문). 가변 값은 대괄호 자리표시자" },
          text_en: { type: "string", description: "같은 조항의 영문" },
          guardrail: { type: "string", description: "법무팀 가드레일: 반드시 유지할 기준과 협상 허용 범위 (한국어)" },
          risk_if_deviating: { type: "string", description: "이 기준에서 벗어날 때 어댑트에 생기는 리스크 (한국어)" },
          severity_if_deviating: { type: "string", enum: ["high", "medium", "low"] },
          kind: { type: "string", enum: ["legal", "commercial"], description: "commercial=금액·지급·납품 수량 등 거래 조건, legal=권리·책임 조항" },
        },
        required: ["no", "title_ko", "title_en", "text_ko", "text_en", "guardrail", "risk_if_deviating", "severity_if_deviating", "kind"],
      },
    },
    notes: { type: "string", description: "이 표준안을 만들며 판단한 점, 대표 계약서 대비 보강한 점 (한국어)" },
  },
  required: ["title_ko", "title_en", "preamble_ko", "preamble_en", "clauses", "notes"],
};

export const TEMPLATE_SYSTEM = `당신은 화장품·식품 브랜드 회사 어댑트(Adapt Inc.)의 사내 변호사입니다.
주어진 계약 유형에 대해 어댑트 법무팀이 앞으로 표준계약서로 쓸 양식을 작성합니다.
원칙:
- 어댑트 입장에서 합리적으로 유리하되 상대방이 수용 가능한 시장 표준 수준으로 작성합니다.
- 대표 계약서의 구조와 문구를 기반으로 하되, 같은 유형의 다른 계약서에서 더 나은 보호 장치가 보이면 반영합니다.
- 금액·기간·브랜드·상대방 이름 등 가변 값은 [대괄호] 자리표시자로 둡니다. 실제 개인정보는 절대 넣지 않습니다.
- 각 조항마다 국문과 영문을 같은 의미로 작성하고, 가드레일(협상 시 양보 가능 범위와 마지노선)을 구체적으로 적습니다.
- 조항은 8~16개로, 이 유형에서 분쟁이 잦은 지점(지식재산권·초상권·2차 활용, 게시 의무·수정 요청, 지급 조건, 위약·환불, 해지, 비밀유지, 준거법)을 빠짐없이 다룹니다.`;

function score(sha: string) {
  const v = extracted(sha);
  const legal = LEGAL_FIELDS.filter((k) => v[k] && v[k] !== "없음").length;
  const len = parseText(sha).length;
  return legal * 10 + Math.min(len / 2000, 10);
}

function pickRepresentative(members: string[]) {
  // 다수 언어를 우선하고, 법적 조항을 많이 갖춘 문서를 대표로 고른다
  const langs = new Map<string, number>();
  for (const s of members) {
    const l = String(extracted(s).language ?? "");
    langs.set(l, (langs.get(l) ?? 0) + 1);
  }
  const major = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pool = members.filter((s) => String(extracted(s).language ?? "") === major);
  return [...(pool.length ? pool : members)].sort((a, b) => score(b) - score(a))[0];
}

export async function generateTemplate(
  studio: StudioClient,
  cat: Pick<Category, "class_key" | "name" | "definition" | "include_criteria" | "typical_clauses">,
  representativeText: string,
  memberSummaries: string[],
) {
  const input = [
    `## 계약 유형\n키: ${cat.class_key}\n이름: ${cat.name}\n정의: ${cat.definition}\n포함 기준: ${cat.include_criteria}\n핵심 조항 후보: ${cat.typical_clauses.join(", ")}`,
    `## 같은 유형 계약서들의 조항 요약 (${memberSummaries.length}건)\n${memberSummaries.join("\n")}`,
    `## 대표 계약서 원문\n${representativeText.slice(0, 28000)}`,
    "위 자료로 이 유형의 어댑트 표준계약서를 작성하세요.",
  ].join("\n\n");
  const { text } = await studio.chat({
    system: TEMPLATE_SYSTEM,
    input,
    jsonSchema: { name: "standard_template", schema: TEMPLATE_SCHEMA },
    reasoningEffort: "medium",
  });
  return JSON.parse(text) as Omit<StandardTemplate, "class_key" | "source" | "status">;
}

export function memberSummary(sha: string, n: number) {
  const v = extracted(sha);
  const cut = (x: unknown, k = 160) => String(x ?? "").replace(/\s+/g, " ").slice(0, k);
  return `- #${n} [${v.language}] ${cut(v.contract_title, 60)} | 지재권:${cut(v.ip_ownership)} | 초상권·2차활용:${cut(v.portrait_rights)} | 독점:${cut(v.exclusivity, 100)} | 위약:${cut(v.penalty_damages)} | 해지:${cut(v.termination, 100)} | 준거법:${cut(v.governing_law_dispute, 80)} | 지급:${cut(v.payment_terms, 100)}`;
}

async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const force = process.argv.includes("--force");
  const tax = readJson<Taxonomy>("f2/taxonomy.json");
  const shaOf = new Map(tax.index.map((r) => [r.id, r.sha256]));
  const studio = new StudioClient();

  const targets = tax.categories.filter((c) => (!only || c.class_key === only) && (force || !exists(`f2/templates/${c.class_key}.json`)));
  console.log(`표준안 생성 대상 ${targets.length}개`);
  await pmap(targets, 4, async (cat) => {
    const members = cat.member_ids.map((id) => shaOf.get(id)!).filter(Boolean);
    const rep = pickRepresentative(members);
    const summaries = members.slice(0, 15).map((s, i) => memberSummary(s, i + 1));
    const t0 = Date.now();
    try {
      const tpl = await generateTemplate(studio, cat, parseText(rep), summaries);
      const out: StandardTemplate = { class_key: cat.class_key, ...tpl, source: "representative", representative_sha256: rep, status: "draft" };
      writeJson(`f2/templates/${cat.class_key}.json`, out);
      console.log(`✔ ${cat.class_key} 조항 ${tpl.clauses.length}개 (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e) {
      console.error(`✘ ${cat.class_key}: ${String(e).slice(0, 300)}`);
    }
  });

  // 커버리지 리포트
  const total = tax.index.length;
  const coverage = tax.categories
    .map((c) => ({
      class_key: c.class_key,
      name: c.name,
      count: c.member_ids.length,
      share: Math.round((c.member_ids.length / total) * 1000) / 10,
      standardizable: c.standardizable,
      standardizable_reason: c.standardizable_reason,
      has_template: exists(`f2/templates/${c.class_key}.json`),
      adapt_standard: false, // 어댑트 25종 원본과 매칭되면 true
    }))
    .sort((a, b) => b.count - a.count);
  writeJson("f2/coverage.json", { total, generated_at: new Date().toISOString(), categories: coverage });
}

if (process.argv[1]?.endsWith("f2-templates.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
