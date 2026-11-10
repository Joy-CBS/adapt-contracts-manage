/**
 * v2 리스크 검토: 어댑트 플레이북(조항별 기준)·공통 포지션·표준계약서 원문으로 검토한다.
 * Studio Workflow "리스크 검토 v2" = Parse → Instruct(Review) → Validate(Verdict)
 *   - 검토 범위(유형)마다 Config 1개. 플레이북·공통 포지션·표준 원문은 Config의 Instruct 질의에 고정해 둔다
 *     (Studio 화면에서 어떤 기준으로 검토하는지 그대로 볼 수 있고, 기준이 바뀌면 Config 새 버전으로 남는다)
 *   - 결론 원칙: [표준]·[법무주석]·[법무확정]이 결론까지 정해 둔 경우에만 "수정 필요"(risk)로 판단한다.
 *     [알림] 탐지, 🔴 필수 조항 이탈인데 결론이 없는 경우, [제안]만 근거인 경우, 해석이 불확실한 경우는
 *     결론을 내리지 않고 "변호사 확인"(needs_lawyer)으로 분류하고 변호사에게 물을 질문을 남긴다.
 *   - 상위 5종 외 유형(기타)은 01_COMMON_POSITIONS(전 표준 공통 기준)까지만 검토한다.
 *   - 대만 인플루언서(tw_inf)는 표준이 없어 공통 기준 + INF-PAID 플레이북을 참고로 보고, 플레이북 대비 차이는 변호사 확인으로 둔다.
 *
 *   npx tsx scripts/v2-review.ts setup
 *   npx tsx scripts/v2-review.ts submit sp4|gpt [--limit N] [--only sha,sha] [--bucket-from sp4]
 *   npx tsx scripts/v2-review.ts collect sp4|gpt
 * 출력: data/v2/review-<model>.json, data/v2/standards/<ID>.json(표준 문단)
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioClient, parseStepText, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { dataDir, loadState, saveState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { BUCKETS, type Bucket } from "@/lib/buckets";
import { outlineForPrompt, readDocxXml, stdParagraphs, type StdParagraph } from "@/lib/docx-std";
import { bucketName, commonPositions, frontmatter, playbook, playbookSection } from "./lib/adapt-kb";
import { checklistFor, checklistForPrompt } from "./lib/checklist";
import { MODELS, type ModelKey, type StepTiming, loadClassify, stepTimings } from "./v2-classify";
import { type RawReview, suggestedBucket } from "@/lib/review-types";

const bool = (description: string) => ({ type: "boolean", description });

export const REVIEW_SCHEMA_V2 = {
  type: "object",
  properties: {
    summary: { type: "string", description: "계약 개요 한두 문장 (한국어)" },
    overall_opinion: { type: "string", description: "담당자가 바로 읽을 검토 의견 3문장 이내 (한국어, 필드명·코드 금지)" },
    adapt_role: { type: "string", enum: ["standard", "role_reversed", "unclear"], description: "어댑트가 표준이 전제한 지위면 standard, 반대 지위(공급인·수탁인·라이선서 등)면 role_reversed" },
    is_high_value: { type: "boolean", description: "총 계약 금액이 1억 원(또는 그 상당 외화) 이상이면 true" },
    items: {
      type: "array",
      description: "검토 항목(C1, C2 …)마다 하나씩, 번호 순서대로 빠짐없이",
      items: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "검토 항목 번호(C1, C2 …) 그대로" },
          grade: { type: "string", enum: ["high", "medium", "low"], description: "검토 항목에 표시된 등급 그대로: 🔴 필수=high, 🟡 협상가능=medium, 🟢 참고=low" },
          finding: {
            type: "string",
            enum: ["일치", "일탈", "누락", "해당 없음"],
            description: "계약서가 기준과 같으면 일치, 다르면 일탈, 해당 조항이 계약서에 없으면 누락, 이 계약에 적용되지 않는 기준이면 해당 없음",
          },
          violates_confirmed: bool("[표준]·[법무주석]·[법무확정] 문구가 이 상황의 결론(수용 불가·반드시 유지·추가한다·허용 수치)을 정해 두었고 계약서가 그 결론에 명확히 어긋나면 true. [제안]만 근거면 false"),
          matched_alert: bool("이 항목의 레드플래그 [알림] 또는 플레이북 6절 알림 규칙의 탐지 조건에 계약서가 해당하면 true"),
          within_allowed: bool("기준과 다르지만 플레이북의 '허용 가능 수정' 범위 안이면 true"),
          uncertain: bool("계약서 문구가 불분명하거나 판독이 어려워 판단에 확신이 없으면 true"),
          standard_ref: { type: "string", description: "대응하는 표준계약서 문단 식별자 하나(예: S12). 표준 원문이 없거나 해당 문단이 없으면 빈 문자열" },
          contract_excerpt: { type: "string", description: "계약서 원문 발췌(원문 언어 그대로, 300자 이내). 누락이면 빈 문자열. 개인정보는 [개인정보]로 가림" },
          issue: { type: "string", description: "기준 대비 차이와 어댑트에 미치는 영향 (한국어 1~2문장). 일치면 빈 문자열" },
          basis_tag: { type: "string", enum: ["[표준]", "[법무주석]", "[법무확정]", "[알림]", "[제안]", "없음"], description: "판단에 쓴 기준 문구의 출처 태그" },
          basis: { type: "string", description: "판단에 쓴 기준 문구 요약 (한국어 한 문장, 수치·기간 정확히)" },
          lawyer_question: { type: "string", description: "일탈·누락이면 변호사에게 확인받을 질문 (한국어 한 문장). 일치면 빈 문자열" },
          suggestion: { type: "string", description: "violates_confirmed가 true일 때만: 계약서와 같은 언어의 수정 조항 문구. 아니면 빈 문자열" },
          suggestion_ko: { type: "string", description: "suggestion의 국문. 계약서가 국문이면 suggestion과 같음" },
        },
        required: [
          "item_id",
          "grade",
          "finding",
          "violates_confirmed",
          "matched_alert",
          "within_allowed",
          "uncertain",
          "standard_ref",
          "contract_excerpt",
          "issue",
          "basis_tag",
          "basis",
          "lawyer_question",
          "suggestion",
          "suggestion_ko",
        ],
      },
    },
    extra_clauses: {
      type: "array",
      description: "검토 항목에 없는데 상대방 계약서에 들어 있는 조항 중 눈여겨볼 것(최대 5개). 없으면 빈 배열",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          contract_excerpt: { type: "string", description: "원문 발췌(300자 이내)" },
          issue: { type: "string", description: "어댑트에 미치는 영향 (한국어)" },
          adverse: bool("어댑트에 불리할 수 있으면 true"),
          lawyer_question: { type: "string", description: "adverse면 변호사에게 확인받을 질문, 아니면 빈 문자열" },
        },
        required: ["title", "contract_excerpt", "issue", "adverse", "lawyer_question"],
      },
    },
  },
  required: ["summary", "overall_opinion", "adapt_role", "is_high_value", "items", "extra_clauses"],
};

/** Studio Validate: 원답의 사실 플래그로 1차 판정(앱은 같은 규칙에 등급·출처를 더해 최종 결론을 낸다) */
const notMatching = (re: string) => `^(?![\\s\\S]*${re})[\\s\\S]*$`;
export function verdictChecks() {
  const ref = { nodeType: "instruct", nodeName: "Review", field: "content" };
  const m = (name: string, severity: string, re: string) => ({ name, severity, condition: { left: ref, operator: "matches", right: { const: notMatching(re) } } });
  return [
    m("확정 기준 위반 없음", "error", `"violates_confirmed"\\s*:\\s*true`),
    m("알림 규칙(레드플래그) 해당 없음", "warning", `"matched_alert"\\s*:\\s*true`),
    m("필수(🔴) 조항 이탈·누락 없음", "warning", `"grade"\\s*:\\s*"high"\\s*,\\s*"finding"\\s*:\\s*"(일탈|누락)"`),
    m("고액 계약 아님(1억 원 미만)", "warning", `"is_high_value"\\s*:\\s*true`),
  ];
}

export const RULES = `답하는 방법 (반드시 지킬 것)
1. 아래 "검토 항목"(C1, C2 …)마다 하나씩, 번호 순서대로 모두 답합니다. item_id와 grade는 항목에 적힌 그대로 씁니다.
2. 당신은 사실만 답합니다: 계약서가 기준과 같은지(finding), 확정 기준 위반인지, 알림 규칙에 해당하는지, 허용 범위 안인지, 확신이 없는지. "수용할지"는 판단하지 않습니다. 최종 결론은 변호사가 내립니다.
3. finding 판단법:
   - 일치: 표준과 의미·조건이 같을 때만입니다. 조항이 "있다"는 것만으로 일치가 아닙니다.
   - 계약마다 채우는 값(제품명, 금액, 날짜, 계정 핸들, 계약번호 등 표준의 빈칸·"실무 기재사항")이 다른 것은 일탈이 아닙니다.
   - 그 밖의 수치·기간·횟수·범위·조건·의무 주체가 하나라도 다르면 일탈입니다(예: 영상 길이 60-80초 → 15-30초, 수정 3회 → 1회, 코드 30일 → 14일, 지급 조건 삭제, pay-or-play 문구). 허용 범위 안이면 within_allowed=true로 따로 표시합니다.
   - 계약서에 해당 조항이 없으면 누락입니다. 일치이면 issue는 비웁니다.
   - 항목의 레드플래그 [알림] 문구와 6절 알림 규칙을 계약서와 하나씩 대조합니다.
4. violates_confirmed는 [표준]·[법무주석]·[법무확정] 문구가 결론까지 정해 둔 경우에만 true입니다. [제안]은 확정 기준이 아닙니다.
5. 레드플래그 [알림]이나 6절 알림 규칙의 탐지 조건에 해당하면 matched_alert=true입니다.
6. 일탈·누락이면 변호사에게 물을 질문(lawyer_question)을 구체적으로 씁니다(무엇이 어떻게 다른지, 무엇을 결정해야 하는지).
7. 주민등록번호·연락처·주소·계좌번호 등 개인정보는 발췌하지 말고 [개인정보]로 가립니다.
8. 문장은 한국어로 씁니다. contract_excerpt는 원문 언어 그대로, suggestion은 계약서와 같은 언어로 씁니다.`;

export type StandardDoc = { standardId: string; title: string; sourceFile: string; paragraphs: StdParagraph[] };

export async function loadStandardDoc(standardId: string): Promise<StandardDoc> {
  const md = playbook(standardId);
  const fm = frontmatter(md);
  const file = path.join(dataDir(), "adapt", "standards", fm.source_file);
  const { documentXml } = await readDocxXml(fs.readFileSync(file));
  return { standardId, title: fm.title ?? standardId, sourceFile: fm.source_file, paragraphs: stdParagraphs(documentXml) };
}

export function playbookContext(id: string) {
  const md = playbook(id);
  return [playbookSection(md, 1), playbookSection(md, 3), playbookSection(md, 6)].filter(Boolean).join("\n\n");
}

export async function reviewQuery(b: Bucket) {
  const list = checklistFor(b);
  const head = `당신은 어댑트(Adapt Inc., 화장품·식품 브랜드사) 법무팀의 1차 계약 검토자입니다. 첨부 계약서를 아래 검토 항목마다 확인해 정해진 JSON으로 답하세요.\n\n${RULES}`;
  if (b.hasStandard && b.standardId) {
    const std = await loadStandardDoc(b.standardId);
    return `${head}

# 검토 범위: ${bucketName(b.key)} (어댑트 표준 ${b.standardId})
standard_ref에는 맨 아래 표준계약서 원문의 문단 식별자(S번호) 하나를 적습니다.

# 검토 항목 (플레이북 ${b.standardId} 2절)
${checklistForPrompt(list)}

# 플레이북 개요·필수 체크리스트·알림 규칙
${playbookContext(b.standardId)}

# 공통 포지션 (판단 참고)
${commonPositions()}

# 표준계약서 원문: ${std.title}
${outlineForPrompt(std.paragraphs)}`;
  }
  if (b.referenceStandardId) {
    return `${head}

# 검토 범위: ${bucketName(b.key)} — 어댑트 표준계약서 없음(신규 표준 제정 필요 유형)
공통 포지션 항목은 전 표준 공통 기준입니다. "참고 기준(확정 아님)" 표시 항목은 유사 유형(${b.referenceStandardId})의 기준이라 이 유형에서는 violates_confirmed를 쓰지 말고 차이만 적습니다. standard_ref는 빈 문자열로 둡니다.

# 검토 항목
${checklistForPrompt(list)}

# 참고 플레이북 알림 규칙
${playbookSection(playbook(b.referenceStandardId), 6)}`;
  }
  return `${head}

# 검토 범위: 기타 유형 — 공통 기준 검토
상위 5개 유형이 아니므로 유형별 플레이북 없이 전 표준 공통 기준(01_COMMON_POSITIONS)까지만 검토합니다. 이 계약에 적용되지 않는 항목(예: 광고가 아닌 계약의 광고 표시의무)은 finding=해당 없음입니다. 유형 고유의 쟁점은 extra_clauses에 남깁니다. standard_ref는 빈 문자열로 둡니다.

# 검토 항목 (01_COMMON_POSITIONS)
${checklistForPrompt(list)}`;
}

export function buildReviewSteps(model: ModelKey, bucketKey: string, query: string, version: string): ConfigStep[] {
  const prefix = `adapt-v2-rv-${bucketKey.replace(/_/g, "-")}-${model}-${version}`;
  return [
    {
      id: `${prefix}-parse`,
      name: "Parse",
      type: "document-parse",
      data: { model: "default", mode: "standard", coordinates: true, output_formats: ["html", "text"] },
      next_steps: [{ step_name: "Review" }],
      is_first: true,
    },
    {
      id: `${prefix}-review`,
      name: "Review",
      type: "instruct",
      data: {
        model: MODELS[model],
        // solar-pro4: 조항 대조처럼 여러 단계를 따져야 하는 작업이라 추론 강도를 높인다(Studio 기본값은 provider 기본)
        // 추론을 높이면 10분(기본 제한)을 넘는 계약이 있어 제한 시간을 20분으로 늘린다
        ...(model === "sp4" ? { reasoning_effort: "high", timeout: 1200 } : {}),
        queries: [query],
        response_format: { type: "json_schema", json_schema: { name: "contract_review_v2", schema: REVIEW_SCHEMA_V2 } },
      },
      next_steps: [{ step_name: "Verdict" }],
      is_first: false,
    },
    { id: `${prefix}-validate`, name: "Verdict", type: "validate", data: { checks: verdictChecks() }, next_steps: null, is_first: false },
  ];
}

export type ReviewRunV2 = {
  jobId: string;
  bucket: string;
  status: "running" | "completed" | "failed";
  verdict?: string;
  /** 검토 Agent 원답(사실 플래그). 결론은 finalizeReview로 낸다 */
  result?: RawReview;
  checks?: unknown;
  error?: string;
  timing?: StepTiming[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};
const storeRel = (m: ModelKey) => `v2/review-${m}.json`;
export const loadReview = (m: ModelKey): Record<string, ReviewRunV2> => (exists(storeRel(m)) ? readJson(storeRel(m)) : {});

async function setup(studio: StudioClient) {
  const state = loadState();
  if (!state.studio.v2ReviewAgentId) {
    const a = await studio.createAgent("어댑트 계약서 리스크 검토 v2 (플레이북 기준)");
    state.studio.v2ReviewAgentId = a.id;
    saveState(state);
  }
  // 표준 문단(변경기록 생성용) 저장
  for (const b of BUCKETS) {
    if (!b.standardId) continue;
    const std = await loadStandardDoc(b.standardId);
    writeJson(`v2/standards/${b.standardId}.json`, std);
  }
  for (const b of BUCKETS) {
    const query = await reviewQuery(b);
    const v = crypto.createHash("sha256").update(JSON.stringify([query, REVIEW_SCHEMA_V2, verdictChecks(), "timeout1200"])).digest("hex").slice(0, 8);
    for (const model of Object.keys(MODELS) as ModelKey[]) {
      const key = `v2Review_${b.key}_${model}`;
      const s = loadState();
      if (s.studio[`${key}_hash`] === v) continue;
      const steps = buildReviewSteps(model, b.key, query, v);
      const cfg = await studio.createConfig(s.studio.v2ReviewAgentId!, steps, {
        name: `리스크 검토 v2 · ${bucketName(b.key)} · ${MODELS[model]} · ${v}`,
        isDefault: false,
      });
      s.studio[key] = cfg.id;
      s.studio[`${key}_hash`] = v;
      saveState(s);
      console.log(b.key, model, "Config", cfg.id, `(질의 ${query.length.toLocaleString()}자)`);
    }
  }
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function submit(studio: StudioClient, model: ModelKey) {
  const limit = Number(arg("limit") ?? Infinity);
  const only = arg("only")?.split(",");
  const bucketFrom = (arg("bucket-from") ?? "sp4") as ModelKey; // 어떤 모델의 분류 결과로 검토 범위를 정할지
  const cls = loadClassify(bucketFrom);
  const state = loadState();
  const store = loadReview(model);
  let n = 0;
  for (const rec of Object.values(state.contracts)) {
    if (n >= limit) break;
    if (!rec.fileId || (only && !only.includes(rec.sha256))) continue;
    const c = cls[rec.sha256];
    if (!c || c.status !== "completed" || !c.label) continue;
    if (c.rationale?.document_kind === "non_contract") continue; // 계약 본문이 아니면 검토하지 않는다
    const bucket = suggestedBucket(c.label, c.rationale);
    const prev = store[rec.sha256];
    if (prev && prev.status !== "failed" && prev.bucket === bucket) continue;
    try {
      const job = await studio.runAgent({
        agentId: state.studio.v2ReviewAgentId!,
        configId: state.studio[`v2Review_${bucket}_${model}`],
        fileIds: [rec.fileId],
        metadata: { sha256: rec.sha256, bucket, purpose: `review-v2-${model}` },
      });
      store[rec.sha256] = { jobId: job.id, bucket, status: "running" };
      writeJson(storeRel(model), store);
      n++;
      await sleep(300);
    } catch (e) {
      console.error("제출 실패", rec.path, String(e).slice(0, 200));
      await sleep(5000);
    }
  }
  console.log(model, `제출 ${n}건`);
}

function slimChecks(v: unknown) {
  const c = v as { verdict?: string; checks?: Array<Record<string, unknown>> } | null;
  if (!c) return null;
  return { verdict: c.verdict, checks: (c.checks ?? []).map((x) => ({ name: x.name, severity: x.severity, passed: x.passed })) };
}

async function collect(studio: StudioClient, model: ModelKey) {
  const store = loadReview(model);
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (["in_progress", "queued", "cancelling"].includes(res.status)) return;
    const timing = { timing: stepTimings(res.output as unknown as Array<Record<string, unknown>>), usage: (res as { usage?: ReviewRunV2["usage"] }).usage ?? null };
    if (res.status !== "completed") {
      store[sha] = { ...r, ...timing, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const ins = res.output?.find((o) => o.step_type === "instruct")?.content?.[0];
    const val = res.output?.find((o) => o.step_type === "validate")?.content?.[0];
    const result = parseStepText<RawReview>(ins?.text?.replace(/【[^】]*†[^】]*】/g, "").replace(/\s+(?=[.,])/g, ""));
    store[sha] = {
      ...r,
      ...timing,
      status: result ? "completed" : "failed",
      result: result ?? undefined,
      verdict: val?.text?.replace(/^"|"$/g, ""),
      checks: slimChecks(parseStepText(val?.additional_values ?? null)),
      error: result ? undefined : "검토 결과 JSON 파싱 실패",
    };
  });
  writeJson(storeRel(model), store);
  const all = Object.values(store);
  const count = (f: (x: ReviewRunV2) => string) => all.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
  console.log(model, "상태", count((x) => x.status), "판정", count((x) => x.verdict ?? "-"));
}

async function main() {
  const [mode, model] = [process.argv[2], process.argv[3] as ModelKey];
  fs.mkdirSync(path.join(dataDir(), "v2"), { recursive: true });
  const studio = new StudioClient();
  if (mode === "setup") return setup(studio);
  if (!(model in MODELS)) throw new Error("model: sp4 | gpt");
  if (mode === "submit") return submit(studio, model);
  if (mode === "collect") return collect(studio, model);
  throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("v2-review.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
