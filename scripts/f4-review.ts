/**
 * F4 리스크 분석: 계약서를 해당 유형의 표준안(가드레일)과 조항 단위로 비교한다.
 * Studio Workflow "검토" Agent = Parse → Instruct(표준안은 실행 요청으로 전달) → Validate(판정)
 * 기존 유형·신규 유형 모두 같은 Agent를 쓰고, 표준안만 바꿔 넣는다.
 *
 *   npm run f4:review -- setup
 *   npm run f4:review -- submit [--limit N]
 *   npm run f4:review -- collect
 * 출력: data/f4/reviews.json (sha256 → 결과)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { StudioClient, parseStepText, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";
import { type ReviewResult, type StandardTemplate, exists, pmap, readJson, writeJson } from "@/lib/contracts";

const VERSION = "v1";

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "계약 개요 한두 문장 (한국어)" },
    overall_opinion: { type: "string", description: "법무팀 검토 의견 요약: 서명 전 반드시 고칠 점 위주 (한국어)" },
    is_high_value: { type: "boolean", description: "총 계약 금액이 1억 원(또는 그 상당 외화) 이상이면 true" },
    clause_reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          standard_clause_no: { type: "integer", description: "대응하는 표준안 조항 번호. 표준안에 없는 추가 조항이면 0" },
          standard_clause_title: { type: "string" },
          status: { type: "string", enum: ["일치", "일탈", "누락", "추가조항"] },
          severity: { type: "string", enum: ["high", "medium", "low", "none"] },
          contract_excerpt: { type: "string", description: "계약서 원문 발췌(원문 언어 그대로). 누락이면 빈 문자열. 개인정보는 [개인정보]로 가림" },
          issue: { type: "string", description: "표준안·가드레일 대비 문제점과 어댑트 리스크 (한국어). 일치면 빈 문자열" },
          suggestion: { type: "string", description: "계약서 언어로 쓴 수정 제안 조항 문구. 일치면 빈 문자열" },
          suggestion_ko: { type: "string", description: "수정 제안의 국문. 계약서가 국문이면 suggestion과 같음" },
        },
        required: ["standard_clause_no", "standard_clause_title", "status", "severity", "contract_excerpt", "issue", "suggestion", "suggestion_ko"],
      },
    },
  },
  required: ["summary", "overall_opinion", "is_high_value", "clause_reviews"],
};

const notMatches = (field: string, value: string) => `^(?![\\s\\S]*"${field}"\\s*:\\s*${value})[\\s\\S]*$`;

export function buildReviewSteps(): ConfigStep[] {
  const instructRef = { nodeType: "instruct", nodeName: "Review", field: "content" };
  return [
    {
      id: `adapt-review-${VERSION}-parse`,
      name: "Parse",
      type: "document-parse",
      data: { model: "default", mode: "standard", coordinates: true, output_formats: ["html", "text"] },
      next_steps: [{ step_name: "Review" }],
      is_first: true,
    },
    {
      id: `adapt-review-${VERSION}-instruct`,
      name: "Review",
      type: "instruct",
      data: {
        model: "default",
        response_format: { type: "json_schema", json_schema: { name: "contract_review", schema: REVIEW_SCHEMA } },
      },
      next_steps: [{ step_name: "Verdict" }],
      is_first: false,
    },
    {
      id: `adapt-review-${VERSION}-validate`,
      name: "Verdict",
      type: "validate",
      data: {
        checks: [
          { name: "고위험 조항 없음", severity: "error", condition: { left: instructRef, operator: "matches", right: { const: notMatches("severity", '"high"') } } },
          { name: "중위험 조항 없음", severity: "warning", condition: { left: instructRef, operator: "matches", right: { const: notMatches("severity", '"medium"') } } },
          { name: "고액 계약 아님(1억 원 미만)", severity: "warning", condition: { left: instructRef, operator: "matches", right: { const: notMatches("is_high_value", "true") } } },
        ],
      },
      next_steps: null,
      is_first: false,
    },
  ];
}

/** 실행 요청에 넣을 지시문: 표준안 + 가드레일 + 검토 규칙 */
export function reviewInstruction(tpl: StandardTemplate, categoryName: string) {
  const clauses = tpl.clauses
    .map((c) => `[제${c.no}조 ${c.title_ko}] (${c.kind}, 일탈 시 ${c.severity_if_deviating})\n표준 문구: ${c.text_ko}\n가드레일: ${c.guardrail}\n일탈 리스크: ${c.risk_if_deviating}`)
    .join("\n\n");
  return `당신은 어댑트(Adapt Inc.) 법무팀 검토자입니다. 첨부 계약서를 아래 "${categoryName}" 표준안과 조항 단위로 비교해 리스크를 검토하세요.
${tpl.status === "draft" ? "※ 이 표준안은 법무팀 확정 전 초안입니다." : ""}

검토 규칙:
1. 표준안 조항마다 계약서의 대응 조항을 찾아 일치/일탈/누락을 판단합니다. 표준안에 없는 계약서 조항 중 어댑트에 불리한 것은 "추가조항"(standard_clause_no=0)으로 적습니다.
2. 가드레일 허용 범위 안이면 "일치", 벗어나면 "일탈"입니다. 단어가 달라도 의미가 같으면 일치입니다.
3. severity는 실제 법적·재무적 영향으로 정합니다. 일치는 none.
   - high: 가드레일의 마지노선을 넘었거나, 어댑트가 권리를 잃거나(콘텐츠 이용 불가 등) 무제한·과도한 책임을 지는 경우, 분쟁 시 어댑트를 보호할 핵심 조항(지재권·2차 활용·손해배상·해지 등)이 없는 경우
   - medium: 가드레일 권장 범위를 벗어나 협상이 필요하지만 당장 큰 손해로 이어지지는 않는 경우
   - low: 운영 세부사항(일정 표기, 파일 규격, 보고 주기 등)이 없거나 문구만 보완하면 되는 경우
   - 표준안이 초안이라 이상적인 수준으로 쓰여 있으므로, 업계에서 통상 수용되는 수준이면 일치 또는 low로 판단합니다.
4. suggestion은 계약서와 같은 언어로, 그대로 붙여 넣을 수 있는 조항 문구로 씁니다. 대괄호 자리표시자는 계약서의 실제 값으로 채웁니다.
5. 금액·지급 같은 커머셜 조항은 법적 조항과 구분해 판단합니다.
6. 주민등록번호·연락처·주소·계좌 등 개인정보는 발췌하지 말고 [개인정보]로 가립니다.
7. 일치 조항도 포함해 표준안의 모든 조항을 한 번씩 다룹니다.

# 표준안: ${tpl.title_ko}
${tpl.preamble_ko}

${clauses}`;
}

type ReviewRun = { jobId: string; class_key: string; status: string; verdict?: string; result?: ReviewResult; checks?: unknown; error?: string };
const STORE = "f4/reviews.json";
const loadStore = () => (exists(STORE) ? readJson<Record<string, ReviewRun>>(STORE) : {});

function classOf(sha: string): string | undefined {
  const c = readJson<Record<string, { label?: string }>>("f2/classify.json");
  return c[sha]?.label;
}

async function setup(studio: StudioClient) {
  const steps = buildReviewSteps();
  fs.writeFileSync(path.resolve("studio/review.json"), JSON.stringify({ name: `리스크 검토 ${VERSION}`, steps }, null, 2) + "\n");
  const state = loadState();
  if (!state.studio.reviewAgentId) {
    const a = await studio.createAgent("어댑트 계약서 리스크 검토 (F4)");
    state.studio.reviewAgentId = a.id;
    saveState(state);
  }
  if (state.studio.reviewConfigVersion !== VERSION) {
    const cfg = await studio.createConfig(state.studio.reviewAgentId!, steps, { name: `리스크 검토 ${VERSION}` });
    const s = loadState();
    s.studio.reviewConfigId = cfg.id;
    s.studio.reviewConfigVersion = VERSION;
    saveState(s);
    console.log("Config 생성:", cfg.id);
  } else console.log("Config 변경 없음");
}

async function submit(studio: StudioClient) {
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
  const state = loadState();
  const store = loadStore();
  const tax = readJson<{ categories: Array<{ class_key: string; name: string }> }>("f2/taxonomy.json");
  const nameOf = new Map(tax.categories.map((c) => [c.class_key, c.name]));
  let n = 0;
  for (const rec of Object.values(state.contracts)) {
    if (n >= limit) break;
    if (!rec.fileId) continue;
    const prev = store[rec.sha256];
    if (prev && prev.status !== "failed") continue;
    const key = classOf(rec.sha256);
    if (!key || !exists(`f2/templates/${key}.json`)) continue;
    const tpl = readJson<StandardTemplate>(`f2/templates/${key}.json`);
    try {
      const job = await studio.runAgent({
        agentId: state.studio.reviewAgentId!,
        configId: state.studio.reviewConfigId,
        fileIds: [rec.fileId],
        instructions: reviewInstruction(tpl, nameOf.get(key) ?? key),
        metadata: { sha256: rec.sha256, class_key: key },
      });
      store[rec.sha256] = { jobId: job.id, class_key: key, status: "running" };
      writeJson(STORE, store);
      n++;
      await sleep(400);
    } catch (e) {
      console.error("제출 실패", rec.path, String(e).slice(0, 200));
      await sleep(5000);
    }
  }
  console.log(`제출 ${n}건`);
}

/** Validate 상세에는 Instruct 원문이 통째로 들어가므로 판정에 필요한 값만 남긴다 */
function slimChecks(v: unknown) {
  const c = v as { verdict?: string; checks?: Array<Record<string, unknown>> } | null;
  if (!c) return null;
  return { verdict: c.verdict, checks: (c.checks ?? []).map((x) => ({ name: x.name, severity: x.severity, passed: x.passed })) };
}

async function collect(studio: StudioClient) {
  const store = loadStore();
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (["in_progress", "queued", "cancelling"].includes(res.status)) return;
    if (res.status !== "completed") {
      store[sha] = { ...r, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const ins = res.output?.find((o) => o.step_type === "instruct")?.content?.[0];
    const val = res.output?.find((o) => o.step_type === "validate")?.content?.[0];
    // Instruct 출력에 섞이는 내부 인용 표시(【†3】)를 제거한다
    const result = parseStepText<ReviewResult>(ins?.text?.replace(/【[^】]*†[^】]*】/g, "").replace(/\s+(?=[.,])/g, ""));
    store[sha] = {
      ...r,
      status: result ? "completed" : "failed",
      result: result ?? undefined,
      verdict: val?.text?.replace(/^"|"$/g, ""),
      checks: slimChecks(parseStepText(val?.additional_values ?? null)),
      error: result ? undefined : "instruct 결과 JSON 파싱 실패",
    };
  });
  writeJson(STORE, store);
  const stat = Object.values(store).reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {});
  const verdicts = Object.values(store).reduce<Record<string, number>>((a, x) => ((a[x.verdict ?? "-"] = (a[x.verdict ?? "-"] ?? 0) + 1), a), {});
  console.log("상태", stat, "판정", verdicts);
}

async function main() {
  const studio = new StudioClient();
  const mode = process.argv[2];
  if (mode === "setup") await setup(studio);
  else if (mode === "submit") await submit(studio);
  else if (mode === "collect") await collect(studio);
  else throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("f4-review.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
