/**
 * v3 리스크 검토: 어댑트 표준 25종 플레이북 전부 + 표준 없는 유형은 공통 기준. 모델 GPT(Studio 기본 모델).
 * 분류·정보 추출은 solar-pro4, 리스크 검토만 GPT(사용자 결정 2026-11-11: SP4는 결론이 소극적이고 3.5배 느림).
 * Studio Workflow "리스크 검토" = Parse → Instruct(Review) → Validate(Verdict). 검토 기준(target)마다 Config 1개:
 *   - 표준 25종: 해당 플레이북 2절 조항 + 표준 원문(S번호)
 *   - tw_inf: 공통 포지션 + INF-PAID 참고(확정 아님)
 *   - common: 그 밖의 유형(표준 필요·기타) — 01_COMMON_POSITIONS
 *
 *   npx tsx scripts/v3-review.ts setup
 *   npx tsx scripts/v3-review.ts submit [--limit N] [--only sha,…]
 *   npx tsx scripts/v3-review.ts collect
 * 출력: data/v3/review.json, data/v3/standards/<ID>.json
 */
import "dotenv/config";
import crypto from "node:crypto";
import { StudioClient, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { RUNNING, readReview } from "@/lib/pipeline";
import { type ChecklistEntry, type RawReview, reviewTargetOf } from "@/lib/review-types";
import { outlineForPrompt } from "@/lib/docx-std";
import { type AdaptCategory, adaptTaxonomy, commonPositions, playbook, playbookSection } from "./lib/adapt-kb";
import { checklistFor, checklistForPrompt } from "./lib/checklist";
import { REVIEW_SCHEMA_V2, RULES, loadStandardDoc, playbookContext, verdictChecks } from "./v2-review";
import { type StepTiming, stepTimings } from "./v2-classify";
import { loadClassifyV3 } from "./v3-classify";

export const REVIEW_MODEL = "default"; // Studio 기본 GPT(prod: gpt-5.4)

export type ReviewTarget = { key: string; name: string; standardId: string | null; referenceStandardId?: string };

/** 검토 기준 목록: 표준 25종 + tw_inf + common */
export function reviewTargets(tax: AdaptCategory[] = adaptTaxonomy()): ReviewTarget[] {
  const std = tax.filter((c) => c.status === "standard_exists" && c.standard_id).map((c) => ({ key: c.category_id, name: c.name_ko, standardId: c.standard_id }));
  const tw = tax.find((c) => c.category_id === "tw_inf");
  return [
    ...std,
    { key: "tw_inf", name: tw?.name_ko ?? "tw_inf", standardId: null, referenceStandardId: "INF-PAID-EN-01" },
    { key: "common", name: "공통 기준(어댑트 표준 없는 유형)", standardId: null },
  ];
}

export function targetChecklist(t: ReviewTarget): ChecklistEntry[] {
  return checklistFor({ key: t.key, standardId: t.standardId, hasStandard: Boolean(t.standardId), referenceStandardId: t.referenceStandardId });
}

const HEAD = `당신은 어댑트(Adapt Inc., 화장품·식품 브랜드사) 법무팀의 1차 계약 검토자입니다. 첨부 계약서를 아래 검토 항목마다 확인해 정해진 JSON으로 답하세요.\n\n${RULES}`;

export async function reviewQueryV3(t: ReviewTarget) {
  const list = targetChecklist(t);
  if (t.standardId) {
    const std = await loadStandardDoc(t.standardId);
    return `${HEAD}

# 검토 범위: ${t.name} (어댑트 표준 ${t.standardId})
standard_ref에는 맨 아래 표준계약서 원문의 문단 식별자(S번호) 하나를 적습니다.

# 검토 항목 (플레이북 ${t.standardId} 2절)
${checklistForPrompt(list)}

# 플레이북 개요·필수 체크리스트·알림 규칙
${playbookContext(t.standardId)}

# 공통 포지션 (판단 참고)
${commonPositions()}

# 표준계약서 원문: ${std.title}
${outlineForPrompt(std.paragraphs)}`;
  }
  if (t.referenceStandardId) {
    return `${HEAD}

# 검토 범위: ${t.name} — 어댑트 표준계약서 없음(신규 표준 제정 필요 유형)
공통 포지션 항목은 전 표준 공통 기준입니다. "참고 기준(확정 아님)" 표시 항목은 유사 유형(${t.referenceStandardId})의 기준이라 이 유형에서는 violates_confirmed를 쓰지 말고 차이만 적습니다. standard_ref는 빈 문자열로 둡니다.

# 검토 항목
${checklistForPrompt(list)}

# 참고 플레이북 알림 규칙
${playbookSection(playbook(t.referenceStandardId), 6)}`;
  }
  return `${HEAD}

# 검토 범위: 어댑트 표준계약서가 없는 유형 — 공통 기준 검토
이 유형은 어댑트 표준이 아직 없어, 전 표준 공통 기준(01_COMMON_POSITIONS)으로 검토합니다. 이 계약에 적용되지 않는 항목(예: 광고가 아닌 계약의 광고 표시의무)은 finding=해당 없음입니다. 유형 고유의 쟁점은 extra_clauses에 남깁니다. standard_ref는 빈 문자열로 둡니다.

# 검토 항목 (01_COMMON_POSITIONS)
${checklistForPrompt(list)}`;
}

function buildSteps(key: string, query: string, version: string): ConfigStep[] {
  const prefix = `adapt-v3-rv-${key.replace(/_/g, "-")}-${version}`;
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
        model: REVIEW_MODEL,
        queries: [query],
        response_format: { type: "json_schema", json_schema: { name: "contract_review", schema: REVIEW_SCHEMA_V2 } },
      },
      next_steps: [{ step_name: "Verdict" }],
      is_first: false,
    },
    { id: `${prefix}-validate`, name: "Verdict", type: "validate", data: { checks: verdictChecks() }, next_steps: null, is_first: false },
  ];
}

export type ReviewRunV3 = {
  jobId: string;
  target: string;
  status: "running" | "completed" | "failed";
  result?: RawReview;
  studioVerdict?: string | null;
  checks?: unknown;
  error?: string;
  timing?: StepTiming[];
};
const STORE = "v3/review.json";
export const loadReviewV3 = (): Record<string, ReviewRunV3> => (exists(STORE) ? readJson(STORE) : {});

async function setup(studio: StudioClient) {
  const s = loadState();
  if (!s.studio.v3ReviewAgentId) {
    s.studio.v3ReviewAgentId = (await studio.createAgent("어댑트 계약서 리스크 검토 (플레이북 25종 · GPT)")).id;
    saveState(s);
  }
  for (const t of reviewTargets()) {
    if (t.standardId) writeJson(`v3/standards/${t.standardId}.json`, await loadStandardDoc(t.standardId));
    const query = await reviewQueryV3(t);
    const v = crypto.createHash("sha256").update(JSON.stringify([query, REVIEW_SCHEMA_V2, verdictChecks(), REVIEW_MODEL])).digest("hex").slice(0, 8);
    const st = loadState();
    if (st.studio[`v3Review_${t.key}_hash`] === v) continue;
    const cfg = await studio.createConfig(st.studio.v3ReviewAgentId!, buildSteps(t.key, query, v), { name: `리스크 검토 · ${t.name} · ${v}`, isDefault: false });
    st.studio[`v3Review_${t.key}`] = cfg.id;
    st.studio[`v3Review_${t.key}_hash`] = v;
    saveState(st);
    console.log(t.key, cfg.id, `${query.length.toLocaleString()}자`);
    await sleep(300);
  }
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function submit(studio: StudioClient) {
  const limit = Number(arg("limit") ?? Infinity);
  const only = arg("only")?.split(",");
  const cls = loadClassifyV3();
  const state = loadState();
  const store = loadReviewV3();
  const tax = adaptTaxonomy();
  const todo = Object.values(state.contracts)
    .filter((r) => r.fileId && (!only || only.includes(r.sha256)))
    .map((r) => {
      const c = cls[r.sha256];
      const type = c?.rationale?.primary_category_id ?? c?.label;
      return { r, type, target: type ? reviewTargetOf(type, tax) : null };
    })
    .filter((x) => x.type && x.type !== "non_contract" && x.target)
    .filter((x) => {
      const prev = store[x.r.sha256];
      return !prev || prev.status === "failed" || prev.target !== x.target;
    })
    .slice(0, limit);
  await pmap(todo, 4, async ({ r, target }) => {
    try {
      const job = await studio.runAgent({
        agentId: state.studio.v3ReviewAgentId!,
        configId: state.studio[`v3Review_${target}`],
        fileIds: [r.fileId!],
        metadata: { sha256: r.sha256, target: target!, purpose: "review-v3" },
      });
      store[r.sha256] = { jobId: job.id, target: target!, status: "running" };
    } catch (e) {
      console.error("제출 실패", r.path, String(e).slice(0, 160));
      await sleep(3000);
    }
  });
  writeJson(STORE, store);
  console.log(`제출 ${todo.length}건`);
}

async function collect(studio: StudioClient) {
  const store = loadReviewV3();
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (RUNNING.includes(res.status)) return;
    const timing = stepTimings(res.output as unknown as Array<Record<string, unknown>>);
    if (res.status !== "completed") {
      store[sha] = { ...r, timing, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const x = readReview(res.output as never);
    store[sha] = {
      ...r,
      timing,
      status: x.raw ? "completed" : "failed",
      result: x.raw ?? undefined,
      studioVerdict: x.studioVerdict,
      checks: x.checks,
      error: x.raw ? undefined : "검토 결과 JSON 파싱 실패",
    };
  });
  writeJson(STORE, store);
  const all = Object.values(store);
  console.log("상태", all.reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {}));
}

async function main() {
  const studio = new StudioClient();
  const mode = process.argv[2];
  if (mode === "setup") return setup(studio);
  if (mode === "submit") return submit(studio);
  if (mode === "collect") return collect(studio);
  throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("v3-review.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
