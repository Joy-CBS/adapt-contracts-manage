/**
 * v2 유형 판단: 어댑트 분류체계(taxonomy.json 49종)와 플레이북 INDEX 결정트리를 기준으로 분류한다.
 * Studio Workflow = Parse → Classify → Rationale
 *   - Classify : 상위 5종 + 기타(others) 6개 클래스. Studio 분류 step
 *   - Rationale: Instruct step. 49종 중 1순위·후보 3개, 일치한 포함/제외 신호와 원문 발췌를 JSON으로 남긴다
 *     → solar-pro4는 신뢰도(logprobs)를 주지 않으므로, 두 step의 일치 여부와 근거 신호로 "분류 근거 수준"을 계산한다
 * 같은 Workflow를 모델만 바꿔 solar-pro4(sp4)와 GPT(Studio 기본 모델, gpt)로 각각 만든다(성능 비교용).
 *
 *   npx tsx scripts/v2-classify.ts setup
 *   npx tsx scripts/v2-classify.ts submit sp4|gpt [--limit N]
 *   npx tsx scripts/v2-classify.ts collect sp4|gpt
 * 출력: data/v2/classify-<model>.json (sha256 → 결과)
 */
import "dotenv/config";
import crypto from "node:crypto";
import { StudioClient, parseStepText, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { BUCKETS, OTHERS_KEY, TOP_KEYS } from "@/lib/buckets";
import { type AdaptCategory, adaptTaxonomy, decisionTree } from "./lib/adapt-kb";
import type { Rationale } from "@/lib/review-types";
export type { Rationale };

export const MODELS = { sp4: "solar-pro4", gpt: "default" } as const;
export type ModelKey = keyof typeof MODELS;

export function rationaleSchema(ids: string[]) {
  const cat = { type: "string", enum: ids };
  return {
    type: "object",
    properties: {
      document_kind: { type: "string", enum: ["contract", "non_contract"], description: "계약 본문이면 contract. 전자서명 감사추적인증서·등록부·브로슈어 등이면 non_contract" },
      primary_category_id: { ...cat, description: "가장 잘 맞는 어댑트 분류 category_id" },
      primary_fit: { type: "string", enum: ["강함", "보통", "약함"], description: "1순위가 정의·포함 신호와 맞는 정도. 다른 유형일 가능성이 있으면 강함을 쓰지 않는다" },
      primary_reason: { type: "string", description: "1순위로 본 이유 (한국어 한 문장)" },
      runner_up_category_id: { type: "string", enum: [...ids, "none"], description: "2순위로 가능성이 있는 category_id. 정말 없으면 none" },
      runner_up_fit: { type: "string", enum: ["강함", "보통", "약함", "해당 없음"], description: "2순위가 맞는 정도" },
      runner_up_reason: { type: "string", description: "2순위가 아닌(또는 될 수 있는) 이유 (한국어 한 문장)" },
      matched_include_signals: {
        type: "array",
        description: "1순위 카테고리의 포함 신호(include_signals) 중 이 문서에서 실제로 확인한 것. 가장 결정적인 것부터 최대 5개. 문서에서 찾지 못한 신호는 넣지 않는다",
        items: {
          type: "object",
          properties: {
            signal: { type: "string", description: "분류 기준에 적힌 신호 문구를 그대로" },
            evidence: { type: "string", description: "그 신호를 확인한 계약서 원문 발췌(원문 언어, 150자 이내). 개인정보는 [개인정보]로 가림" },
          },
          required: ["signal", "evidence"],
        },
      },
      matched_exclude_signals: {
        type: "array",
        description: "1순위 카테고리의 제외 신호(exclude_signals) 중 이 문서에 해당하는 것(다른 유형일 가능성). 없으면 빈 배열",
        items: {
          type: "object",
          properties: {
            signal: { type: "string" },
            evidence: { type: "string", description: "계약서 원문 발췌(150자 이내)" },
            points_to: { ...cat, description: "이 신호가 가리키는 다른 category_id" },
          },
          required: ["signal", "evidence", "points_to"],
        },
      },
      counterparty_kind: { type: "string", enum: ["individual", "agency_mcn", "company", "unclear"], description: "상대방: 개인 크리에이터/모델, 소속사·MCN·대행사, 일반 기업" },
      adapt_role: {
        type: "string",
        enum: ["standard", "role_reversed", "unclear"],
        description: "어댑트가 표준이 전제한 지위(대가 지급자·발주자·광고주)면 standard, 공급인·수탁인·라이선서·양도인이면 role_reversed",
      },
      explanation: { type: "string", description: "분류 판단 요약 (한국어 2~3문장): 무엇을 보고 이 유형으로 판단했는지" },
    },
    required: [
      "document_kind",
      "primary_category_id",
      "primary_fit",
      "primary_reason",
      "runner_up_category_id",
      "runner_up_fit",
      "runner_up_reason",
      "matched_include_signals",
      "matched_exclude_signals",
      "counterparty_kind",
      "adapt_role",
      "explanation",
    ],
  };
}

function compactCategory(c: AdaptCategory) {
  return [
    `### ${c.category_id} — ${c.name_ko} (${c.status === "standard_exists" ? `표준 ${c.standard_id}` : c.status === "standard_needed" ? "표준 없음" : "검토 대상 아님"})`,
    `정의: ${c.definition}`,
    `포함 신호: ${c.include_signals.map((s) => `「${s}」`).join(" ")}`,
    c.exclude_signals.length ? `제외 신호: ${c.exclude_signals.map((s) => `「${s}」`).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function rationaleQuery(tax: AdaptCategory[]) {
  return `당신은 어댑트(Adapt Inc., 화장품·식품 브랜드사) 법무팀의 계약서 분류 담당자입니다.
첨부 문서를 아래 "어댑트 계약 분류체계"의 category_id 하나로 분류하고, 판단 근거를 정해진 JSON 형식으로 남기세요.

판단 원칙
1. 언어·브랜드·금액·국가가 아니라 당사자 관계, 계약 목적, 핵심 의무 구조(신규 제작인지 기존 콘텐츠 사용권인지, 정액인지 성과연동인지 등)로 판단합니다.
2. 각 카테고리의 포함 신호와 제외 신호를 대조합니다. 제외 신호에 해당하면 그 신호가 가리키는 카테고리를 우선 검토합니다.
3. matched_include_signals에는 문서에서 실제로 확인한 신호만 넣고, 원문 발췌를 그대로 붙입니다. 확인하지 못한 신호를 추측해 넣지 않습니다.
4. 두 카테고리 사이에서 판단이 갈리면 1순위·2순위에 나눠 적고 fit를 정직하게 적습니다. 확신이 없으면 "강함"을 쓰지 않습니다.
5. 어느 카테고리에도 맞지 않으면 other, 계약 본문이 아니면 non_contract를 고릅니다.
6. 주민등록번호·연락처·주소·계좌 등 개인정보는 발췌하지 않고 [개인정보]로 가립니다.

# 혼동 쌍 결정트리 (어댑트 플레이북 INDEX)
${decisionTree()}

# 어댑트 계약 분류체계 (${tax.length}종)
${tax.map(compactCategory).join("\n\n")}`;
}

export function classifyClasses(tax: AdaptCategory[]) {
  const byId = new Map(tax.map((c) => [c.category_id, c]));
  const top = TOP_KEYS.map((k) => {
    const c = byId.get(k)!;
    return {
      const: k,
      description: `${c.name_ko}. ${c.definition} 포함 신호: ${c.include_signals.join(" / ")}. 제외: ${c.exclude_signals.join(" / ")}`,
    };
  });
  const rest = tax.filter((c) => !TOP_KEYS.includes(c.category_id)).map((c) => c.name_ko);
  return [
    ...top,
    {
      const: OTHERS_KEY,
      description: `위 5개 유형이 아닌 모든 문서. 예: ${rest.join(", ")}. 위 5개 중 하나의 정의와 포함 신호에 분명히 맞지 않으면 이 클래스를 고른다.`,
    },
  ];
}

export function buildClassifySteps(model: ModelKey, tax: AdaptCategory[], version: string): ConfigStep[] {
  const m = MODELS[model];
  const prefix = `adapt-v2-cls-${model}-${version}`;
  return [
    {
      id: `${prefix}-parse`,
      name: "Parse",
      type: "document-parse",
      data: { model: "default", mode: "standard", coordinates: true, output_formats: ["html", "text"] },
      next_steps: [{ step_name: "Classify" }],
      is_first: true,
    },
    {
      id: `${prefix}-classify`,
      name: "Classify",
      type: "document-classify",
      data: {
        model: m,
        // solar-pro4는 logprobs를 주지 않아 Studio가 신뢰도를 끈다. GPT는 비교용으로 켠다
        confidence: model === "gpt",
        split: false,
        system_prompt:
          "어댑트(Adapt Inc.) 계약서를 어댑트 법무팀 분류체계로 분류한다. 언어·브랜드·금액·국가가 아니라 당사자 관계, 계약 목적, 핵심 의무 구조로 판단한다. " +
          "결정트리: 영문 인플루언서 계약에서 TikTok Shop·쇼퍼블 링크·커미션이 있으면 inf_ttaff_en, 정액 수수료와 Spark/Branded Ads 코드면 inf_paid_en. " +
          "국문 신규 콘텐츠 제작에서 상대방이 크리에이터 본인이면 adc_crt_kr, 소속사·MCN 법인이면 adc_agy_kr. Adapt Taiwan 또는 대만 크리에이터와의 중문 계약은 tw_inf. 그 밖의 모든 문서는 others.",
        json_schema: { type: "string", oneOf: classifyClasses(tax) },
      },
      // Studio Workflow는 한 step에서 여러 갈래로 나눌 수 없어 Classify 다음에 Rationale을 잇는다(문서는 그대로 전달됨)
      next_steps: [{ step_name: "Rationale" }],
      is_first: false,
    },
    {
      id: `${prefix}-rationale`,
      name: "Rationale",
      type: "instruct",
      data: {
        model: m,
        queries: [rationaleQuery(tax)],
        response_format: {
          type: "json_schema",
          json_schema: { name: "classification_rationale", schema: rationaleSchema(tax.map((c) => c.category_id)) },
        },
      },
      next_steps: null,
      is_first: false,
    },
  ];
}

export type ClassifyRun = {
  jobId: string;
  status: "running" | "completed" | "failed";
  label?: string;
  confidence?: number | null;
  rationale?: Rationale | null;
  error?: string;
  submittedAt?: number;
  /** step별 소요 시간(초)과 Job 전체 토큰 사용량: 모델 비교용 */
  timing?: StepTiming[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};

export type StepTiming = { step: string; seconds: number | null; cacheHit?: boolean };

/** Job 출력의 step별 created_at~updated_at(초). Parse는 캐시 적중 여부도 남긴다 */
export function stepTimings(output: Array<Record<string, unknown>> | undefined): StepTiming[] {
  return (output ?? []).map((o) => {
    const c = typeof o.created_at === "string" ? Date.parse(o.created_at) : Number(o.created_at) * 1000;
    const u = typeof o.updated_at === "string" ? Date.parse(o.updated_at) : Number(o.updated_at) * 1000;
    const av = parseStepText<Record<string, unknown>>((o.content as Array<{ additional_values?: string | null }> | undefined)?.[0]?.additional_values ?? null);
    return { step: String(o.step_type), seconds: Number.isFinite(c) && Number.isFinite(u) ? Math.round((u - c) / 100) / 10 : null, cacheHit: av?.cache_hit === true ? true : undefined };
  });
}

const storeRel = (model: ModelKey) => `v2/classify-${model}.json`;
export const loadClassify = (model: ModelKey): Record<string, ClassifyRun> => (exists(storeRel(model)) ? readJson(storeRel(model)) : {});

function versionHash(tax: AdaptCategory[]) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([rationaleQuery(tax), classifyClasses(tax), rationaleSchema(tax.map((c) => c.category_id)), BUCKETS.map((b) => b.key)]))
    .digest("hex")
    .slice(0, 8);
}

async function setup(studio: StudioClient) {
  const tax = adaptTaxonomy();
  const v = versionHash(tax);
  const state = loadState();
  if (!state.studio.v2ClassifyAgentId) {
    const a = await studio.createAgent("어댑트 계약서 유형 판단 v2 (어댑트 분류체계)");
    state.studio.v2ClassifyAgentId = a.id;
    saveState(state);
  }
  for (const model of Object.keys(MODELS) as ModelKey[]) {
    const s = loadState();
    if (s.studio[`v2ClassifyHash_${model}`] === v) {
      console.log(model, "Config 변경 없음", s.studio[`v2ClassifyConfig_${model}`]);
      continue;
    }
    const steps = buildClassifySteps(model, tax, v);
    writeJson(`v2/studio-classify-${model}.json`, { name: `유형 판단 v2 ${model} ${v}`, steps });
    const cfg = await studio.createConfig(s.studio.v2ClassifyAgentId!, steps, { name: `유형 판단 v2 · ${MODELS[model]} · ${v}`, isDefault: model === "sp4" });
    s.studio[`v2ClassifyConfig_${model}`] = cfg.id;
    s.studio[`v2ClassifyHash_${model}`] = v;
    saveState(s);
    console.log(model, "Config 생성", cfg.id);
  }
}

async function submit(studio: StudioClient, model: ModelKey) {
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
  const state = loadState();
  const store = loadClassify(model);
  let n = 0;
  for (const rec of Object.values(state.contracts)) {
    if (n >= limit) break;
    if (!rec.fileId) continue;
    const prev = store[rec.sha256];
    if (prev && prev.status !== "failed") continue;
    try {
      const job = await studio.runAgent({
        agentId: state.studio.v2ClassifyAgentId!,
        configId: state.studio[`v2ClassifyConfig_${model}`],
        fileIds: [rec.fileId],
        metadata: { sha256: rec.sha256, purpose: `classify-v2-${model}` },
      });
      store[rec.sha256] = { jobId: job.id, status: "running", submittedAt: Date.now() };
      writeJson(storeRel(model), store);
      n++;
      await sleep(250);
    } catch (e) {
      console.error("제출 실패", rec.path, String(e).slice(0, 200));
      await sleep(5000);
    }
  }
  console.log(model, `제출 ${n}건`);
}

async function collect(studio: StudioClient, model: ModelKey) {
  const store = loadClassify(model);
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (["in_progress", "queued", "cancelling"].includes(res.status)) return;
    const timing = { timing: stepTimings(res.output as unknown as Array<Record<string, unknown>>), usage: (res as { usage?: ClassifyRun["usage"] }).usage ?? null };
    if (res.status !== "completed") {
      store[sha] = { ...r, ...timing, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const cls = res.output?.find((o) => o.step_type === "document-classify")?.content?.[0];
    const ins = res.output?.find((o) => o.step_type === "instruct")?.content?.[0];
    const extra = parseStepText<Record<string, unknown>>(cls?.additional_values ?? null);
    const rationale = parseStepText<Rationale>(ins?.text?.replace(/【[^】]*†[^】]*】/g, ""));
    const conf = (extra?.document_type as { confidence_score?: unknown } | undefined)?.confidence_score;
    store[sha] = {
      ...r,
      ...timing,
      status: "completed",
      label: cls?.text?.replace(/^"|"$/g, ""),
      confidence: typeof conf === "number" ? conf : null,
      rationale,
      error: rationale ? undefined : "Rationale JSON 파싱 실패",
    };
  });
  writeJson(storeRel(model), store);
  const stat = Object.values(store).reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {});
  const labels = Object.values(store).reduce<Record<string, number>>((a, x) => ((a[x.label ?? "-"] = (a[x.label ?? "-"] ?? 0) + 1), a), {});
  console.log(model, "상태", stat, "라벨", labels);
}

async function main() {
  const [mode, model] = [process.argv[2], process.argv[3] as ModelKey];
  const studio = new StudioClient();
  if (mode === "setup") return setup(studio);
  if (!(model in MODELS)) throw new Error("model: sp4 | gpt");
  if (mode === "submit") return submit(studio, model);
  if (mode === "collect") return collect(studio, model);
  throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("v2-classify.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
