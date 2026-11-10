/**
 * 추론 모델 SP4 전환: F1 정보 추출을 solar-pro4로 다시 실행한다.
 * F1 적재 Workflow(studio/ingest.json)의 Parse·Extract를 그대로 쓰되 Extract 모델만 solar-pro4로 바꾼
 * 별도 Agent를 만든다(기존 GPT 결과 data/f1/extract는 비교용으로 보존).
 * solar-pro4는 logprobs가 없어 Studio가 추출 신뢰도를 끈다(confidence: false).
 *
 *   npx tsx scripts/v2-extract.ts setup
 *   npx tsx scripts/v2-extract.ts submit [--limit N]
 *   npx tsx scripts/v2-extract.ts collect
 * 출력: data/v2/extract-sp4.json (sha256 → { jobId, status, value, timing })
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { StudioClient, parseStepText, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { loadState, saveState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { type StepTiming, stepTimings } from "./v2-classify";

const VERSION = "v2";
const STORE = "v2/extract-sp4.json";

export type ExtractRun = {
  jobId: string;
  status: "running" | "completed" | "failed";
  value?: Record<string, unknown> | null;
  error?: string;
  timing?: StepTiming[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};
export const loadExtract = (): Record<string, ExtractRun> => (exists(STORE) ? readJson(STORE) : {});

function buildSteps(): ConfigStep[] {
  const def = JSON.parse(fs.readFileSync(path.resolve("studio/ingest.json"), "utf8")) as { steps: ConfigStep[] };
  const parse = def.steps.find((s) => s.type === "document-parse")!;
  const extract = def.steps.find((s) => s.type === "information-extract")!;
  return [
    { ...parse, id: `adapt-${VERSION}-sp4-parse`, next_steps: [{ step_name: extract.name }] },
    { ...extract, id: `adapt-${VERSION}-sp4-extract`, data: { ...extract.data, model: "solar-pro4", confidence: false }, next_steps: null },
  ];
}

async function setup(studio: StudioClient) {
  const state = loadState();
  if (state.studio.v2ExtractConfigId) return console.log("Config 있음", state.studio.v2ExtractConfigId);
  const a = await studio.createAgent("어댑트 계약서 정보 추출 (solar-pro4)");
  const steps = buildSteps();
  writeJson("v2/studio-extract-sp4.json", { name: "정보 추출 solar-pro4", steps });
  const cfg = await studio.createConfig(a.id, steps, { name: "정보 추출 · solar-pro4", isDefault: true });
  state.studio.v2ExtractAgentId = a.id;
  state.studio.v2ExtractConfigId = cfg.id;
  saveState(state);
  console.log("Config 생성", cfg.id);
}

async function submit(studio: StudioClient) {
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
  const state = loadState();
  const store = loadExtract();
  let n = 0;
  for (const rec of Object.values(state.contracts)) {
    if (n >= limit) break;
    if (!rec.fileId) continue;
    if (store[rec.sha256] && store[rec.sha256].status !== "failed") continue;
    try {
      const job = await studio.runAgent({
        agentId: state.studio.v2ExtractAgentId!,
        configId: state.studio.v2ExtractConfigId,
        fileIds: [rec.fileId],
        metadata: { sha256: rec.sha256, purpose: "extract-sp4" },
      });
      store[rec.sha256] = { jobId: job.id, status: "running" };
      writeJson(STORE, store);
      n++;
      await sleep(250);
    } catch (e) {
      console.error("제출 실패", rec.path, String(e).slice(0, 200));
      await sleep(5000);
    }
  }
  console.log(`제출 ${n}건`);
}

async function collect(studio: StudioClient) {
  const store = loadExtract();
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  await pmap(pending, 8, async ([sha, r]) => {
    const res = await studio.getResponse(r.jobId, "all");
    if (["in_progress", "queued", "cancelling"].includes(res.status)) return;
    const timing = { timing: stepTimings(res.output as unknown as Array<Record<string, unknown>>), usage: (res as { usage?: ExtractRun["usage"] }).usage ?? null };
    if (res.status !== "completed") {
      store[sha] = { ...r, ...timing, status: "failed", error: res.error?.message ?? res.status };
      return;
    }
    const c = res.output?.find((o) => o.step_type === "information-extract")?.content?.[0];
    const value = parseStepText<Record<string, unknown>>(c?.text ?? null);
    store[sha] = { ...r, ...timing, status: value ? "completed" : "failed", value, error: value ? undefined : "추출 결과 JSON 파싱 실패" };
  });
  writeJson(STORE, store);
  const stat = Object.values(store).reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {});
  console.log("상태", stat);
}

async function main() {
  const studio = new StudioClient();
  const mode = process.argv[2];
  if (mode === "setup") return setup(studio);
  if (mode === "submit") return submit(studio);
  if (mode === "collect") return collect(studio);
  throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("v2-extract.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
