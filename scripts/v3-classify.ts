/**
 * v3 유형 판단: 어댑트 분류체계 전체(taxonomy.json 49종: 표준 25종 + 표준 필요 + 검토 대상 아님)로 분류한다. 모델 solar-pro4.
 * Studio Workflow = Parse → Classify(49개 클래스) → Rationale(Instruct: 1·2순위, 포함/제외 신호와 원문 발췌)
 * solar-pro4는 신뢰도 점수가 없어, 두 step이 같은 유형을 가리키는지와 근거 신호로 "근거 수준"을 매긴다.
 *
 *   npx tsx scripts/v3-classify.ts setup
 *   npx tsx scripts/v3-classify.ts submit [--limit N]
 *   npx tsx scripts/v3-classify.ts collect
 * 출력: data/v3/classify.json (sha256 → 결과). 서버(검토 요청)는 같은 Agent·Config를 쓴다.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { StudioClient, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { RUNNING, readClassify } from "@/lib/pipeline";
import type { Rationale } from "@/lib/review-types";
import { type AdaptCategory, adaptTaxonomy, decisionTree } from "./lib/adapt-kb";
import { type StepTiming, rationaleQuery, rationaleSchema, stepTimings } from "./v2-classify";

export type ClassifyRunV3 = {
  jobId: string;
  status: "running" | "completed" | "failed";
  label?: string | null;
  rationale?: Rationale | null;
  error?: string;
  timing?: StepTiming[];
};

const STORE = "v3/classify.json";
export const loadClassifyV3 = (): Record<string, ClassifyRunV3> => (exists(STORE) ? readJson(STORE) : {});

export function classifyClassesV3(tax: AdaptCategory[]) {
  return tax.map((c) => ({
    const: c.category_id,
    description: [
      c.name_ko,
      c.definition,
      c.include_signals.length ? `포함 신호: ${c.include_signals.join(" / ")}` : "",
      c.exclude_signals.length ? `제외: ${c.exclude_signals.join(" / ")}` : "",
    ]
      .filter(Boolean)
      .join(". "),
  }));
}

export function buildClassifyStepsV3(tax: AdaptCategory[], version: string): ConfigStep[] {
  const prefix = `adapt-v3-cls-${version}`;
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
        model: "solar-pro4",
        confidence: false, // solar-pro4는 logprobs 미지원
        split: false,
        system_prompt: `어댑트(Adapt Inc.) 계약서를 어댑트 법무팀 분류체계로 분류한다. 언어·브랜드·금액·국가가 아니라 당사자 관계, 계약 목적, 핵심 의무 구조로 판단한다. 계약 본문이 아니면 non_contract, 어디에도 맞지 않으면 other.\n\n${decisionTree()}`,
        json_schema: { type: "string", oneOf: classifyClassesV3(tax) },
      },
      next_steps: [{ step_name: "Rationale" }],
      is_first: false,
    },
    {
      id: `${prefix}-rationale`,
      name: "Rationale",
      type: "instruct",
      data: {
        model: "solar-pro4",
        queries: [rationaleQuery(tax)],
        response_format: { type: "json_schema", json_schema: { name: "classification_rationale", schema: rationaleSchema(tax.map((c) => c.category_id)) } },
      },
      next_steps: null,
      is_first: false,
    },
  ];
}

async function setup(studio: StudioClient) {
  const tax = adaptTaxonomy();
  const v = crypto
    .createHash("sha256")
    .update(JSON.stringify([rationaleQuery(tax), classifyClassesV3(tax), rationaleSchema(tax.map((c) => c.category_id)), decisionTree()]))
    .digest("hex")
    .slice(0, 8);
  const s = loadState();
  if (!s.studio.v3ClassifyAgentId) {
    s.studio.v3ClassifyAgentId = (await studio.createAgent("어댑트 계약서 유형 판단 (분류체계 전체 · solar-pro4)")).id;
    saveState(s);
  }
  if (s.studio.v3ClassifyHash === v) return console.log("Config 변경 없음", s.studio.v3ClassifyConfigId);
  const steps = buildClassifyStepsV3(tax, v);
  writeJson("v3/studio-classify.json", { steps });
  const cfg = await studio.createConfig(s.studio.v3ClassifyAgentId!, steps, { name: `유형 판단 v3 · solar-pro4 · ${v}`, isDefault: true });
  const s2 = loadState();
  s2.studio.v3ClassifyConfigId = cfg.id;
  s2.studio.v3ClassifyHash = v;
  saveState(s2);
  console.log("Config 생성", cfg.id);
}

async function submit(studio: StudioClient) {
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
  const state = loadState();
  const store = loadClassifyV3();
  const todo = Object.values(state.contracts).filter((r) => r.fileId && (!store[r.sha256] || store[r.sha256].status === "failed")).slice(0, limit);
  // 제출 왕복이 느려 4개씩 병렬로 넣는다
  await pmap(todo, 4, async (rec) => {
    try {
      const job = await studio.runAgent({
        agentId: state.studio.v3ClassifyAgentId!,
        configId: state.studio.v3ClassifyConfigId,
        fileIds: [rec.fileId!],
        metadata: { sha256: rec.sha256, purpose: "classify-v3" },
      });
      store[rec.sha256] = { jobId: job.id, status: "running" };
    } catch (e) {
      console.error("제출 실패", rec.path, String(e).slice(0, 160));
      await sleep(3000);
    }
  });
  writeJson(STORE, store);
  console.log(`제출 ${todo.length}건`);
}

async function collect(studio: StudioClient) {
  const store = loadClassifyV3();
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (RUNNING.includes(res.status)) return;
    const timing = stepTimings(res.output as unknown as Array<Record<string, unknown>>);
    if (res.status !== "completed") {
      store[sha] = { ...r, timing, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const c = readClassify(res.output as never);
    store[sha] = { ...r, timing, status: "completed", label: c.label, rationale: c.rationale, error: c.rationale ? undefined : "Rationale 파싱 실패" };
  });
  writeJson(STORE, store);
  const all = Object.values(store);
  const count = (f: (x: ClassifyRunV3) => string) => all.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
  console.log("상태", count((x) => x.status));
  console.log("Classify=Rationale", all.filter((x) => x.label && x.label === x.rationale?.primary_category_id).length, "/", all.filter((x) => x.status === "completed").length);
}

async function main() {
  const studio = new StudioClient();
  const mode = process.argv[2];
  if (mode === "setup") return setup(studio);
  if (mode === "submit") return submit(studio);
  if (mode === "collect") return collect(studio);
  throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("v3-classify.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
