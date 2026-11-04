/**
 * F2-2 유형 판단 Agent: taxonomy.json으로 Studio Classify Config를 만들고 계약서에 실행한다.
 * 이 Agent는 F3(신규 계약서 유형 판단)에서도 그대로 사용한다.
 *
 *   npm run f2:classify -- setup         # Agent·Config 생성 (studio/classify.json 갱신)
 *   npm run f2:classify -- submit        # F1 File에 분류 Job 제출(대기 없음)
 *   npm run f2:classify -- collect       # 완료된 결과 수집 → data/f2/classify.json
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioClient, parseStepText, sleep } from "@/lib/studio/client";
import type { ConfigStep } from "@/lib/studio/types";
import { dataDir, loadState, saveState } from "@/lib/state";
import type { Category } from "@/lib/contracts";

export const NEW_TYPE_KEY = "new_type";

type ClassifyRun = { jobId: string; status: string; label?: string; confidence?: unknown; error?: string };
type ClassifyStore = Record<string, ClassifyRun>; // key = sha256

const storePath = () => path.join(dataDir(), "f2", "classify.json");
const loadStore = (): ClassifyStore => (fs.existsSync(storePath()) ? JSON.parse(fs.readFileSync(storePath(), "utf8")) : {});
const saveStore = (s: ClassifyStore) => fs.writeFileSync(storePath(), JSON.stringify(s, null, 1));

export function buildClassifySteps(categories: Category[], version: string): ConfigStep[] {
  const oneOf = [
    ...categories.map((c) => ({
      const: c.class_key,
      description: `${c.name}. ${c.definition} 포함: ${c.include_criteria} 제외: ${c.exclude_criteria}`,
    })),
    {
      const: NEW_TYPE_KEY,
      description: "위 어떤 유형의 정의에도 맞지 않는 새로운 형태의 계약. 기존 유형과 당사자 관계나 계약 목적이 분명히 다를 때만 선택한다.",
    },
  ];
  return [
    {
      id: `adapt-classify-${version}-parse`,
      name: "Parse",
      type: "document-parse",
      data: { model: "default", mode: "standard", coordinates: true, output_formats: ["html", "text"] },
      next_steps: [{ step_name: "Classify" }],
      is_first: true,
    },
    {
      id: `adapt-classify-${version}-classify`,
      name: "Classify",
      type: "document-classify",
      data: {
        model: "default",
        confidence: true,
        split: false,
        system_prompt:
          "어댑트(Adapt Inc.) 계약서를 법무팀 표준계약서 유형으로 분류한다. 언어(한국어·영어·중국어)·브랜드·금액·국가는 유형 판단 기준이 아니다. 당사자 관계와 계약 목적, 핵심 의무 구조로 판단한다.",
        json_schema: { type: "string", oneOf },
      },
      next_steps: null,
      is_first: false,
    },
  ];
}

async function setup(studio: StudioClient) {
  const tax = JSON.parse(fs.readFileSync(path.join(dataDir(), "f2", "taxonomy.json"), "utf8")) as { categories: Category[] };
  const hash = crypto.createHash("sha256").update(JSON.stringify(tax.categories.map((c) => [c.class_key, c.definition]))).digest("hex").slice(0, 8);
  const steps = buildClassifySteps(tax.categories, hash);
  fs.writeFileSync(path.resolve("studio/classify.json"), JSON.stringify({ name: `유형 판단 ${hash}`, steps }, null, 2) + "\n");

  const state = loadState();
  if (!state.studio.classifyAgentId) {
    const agent = await studio.createAgent("어댑트 계약서 유형 판단 (F2·F3)");
    state.studio.classifyAgentId = agent.id;
    saveState(state);
  }
  if (state.studio.classifyConfigHash !== hash) {
    const cfg = await studio.createConfig(state.studio.classifyAgentId!, steps, { name: `유형 판단 ${hash}` });
    const s = loadState();
    s.studio.classifyConfigId = cfg.id;
    s.studio.classifyConfigHash = hash;
    saveState(s);
    console.log("Config 생성:", cfg.id);
  } else console.log("Config 변경 없음");
}

async function submit(studio: StudioClient) {
  const state = loadState();
  const store = loadStore();
  const { classifyAgentId: agentId, classifyConfigId: configId } = state.studio;
  let n = 0;
  for (const rec of Object.values(state.contracts)) {
    if (!rec.fileId) continue;
    const prev = store[rec.sha256];
    if (prev && prev.status !== "failed") continue;
    try {
      const job = await studio.runAgent({ agentId: agentId!, configId, fileIds: [rec.fileId] });
      store[rec.sha256] = { jobId: job.id, status: "running" };
      saveStore(store);
      n++;
    } catch (e) {
      console.error("제출 실패", rec.path, String(e));
      await sleep(3000);
    }
  }
  console.log(`제출 ${n}건`);
}

async function collect(studio: StudioClient) {
  const store = loadStore();
  const pending = Object.entries(store).filter(([, r]) => r.status === "running");
  let i = 0;
  async function worker() {
    for (;;) {
      const item = pending[i++];
      if (!item) return;
      const [sha, r] = item;
      const res = await studio.getResponse(r.jobId, "last");
      if (res.status === "in_progress" || res.status === "queued" || res.status === "cancelling") continue;
      if (res.status !== "completed") {
        store[sha] = { ...r, status: "failed", error: res.error?.message };
        continue;
      }
      const c = res.output?.find((o) => o.step_type === "document-classify")?.content?.[0] ?? res.output?.at(-1)?.content?.[0];
      const extra = parseStepText<Record<string, unknown>>(c?.additional_values ?? null);
      store[sha] = { jobId: r.jobId, status: "completed", label: c?.text?.replace(/^"|"$/g, ""), confidence: extra?.confidence ?? extra };
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  saveStore(store);
  const stat = Object.values(store).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  console.log("상태", stat);
}

async function main() {
  const mode = process.argv[2];
  fs.mkdirSync(path.join(dataDir(), "f2"), { recursive: true });
  const studio = new StudioClient();
  if (mode === "setup") await setup(studio);
  else if (mode === "submit") await submit(studio);
  else if (mode === "collect") await collect(studio);
  else throw new Error("mode: setup | submit | collect");
}

if (process.argv[1]?.endsWith("f2-classify.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
