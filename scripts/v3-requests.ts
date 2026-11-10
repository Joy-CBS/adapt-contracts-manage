/**
 * 데모용 "검토 요청" 샘플: 기존 200건에 없는 계약서를 실제 검토 요청과 같은 경로로 처리한다.
 *   업로드 → 정보 추출(SP4) + 유형 판단(SP4) → (일부만) 리스크 검토(GPT)
 * 단계가 섞이도록 일부는 유형 확인 대기로 남긴다. 결과는 data/v3/requests.json → 시드 묶음에 들어간다.
 *
 *   npx tsx scripts/v3-requests.ts submit <dir>   # dir 안의 r*.pdf + index.tsv(원본 경로)
 *   npx tsx scripts/v3-requests.ts collect
 *   npx tsx scripts/v3-requests.ts review r2,r3   # 유형 확정 후 검토 시작(제안 유형으로)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { StudioClient } from "@/lib/studio/client";
import { loadState } from "@/lib/state";
import { exists, pmap, readJson, writeJson } from "@/lib/contracts";
import { RUNNING, readClassify, readExtract, readReview } from "@/lib/pipeline";
import { type RawReview, type Rationale, reviewTargetOf } from "@/lib/review-types";
import { adaptTaxonomy } from "./lib/adapt-kb";

export type SampleRequest = {
  key: string;
  filename: string;
  sourcePath: string;
  fileId: string;
  extractJobId: string;
  classifyJobId: string;
  extract?: Record<string, unknown> | null;
  label?: string | null;
  rationale?: Rationale | null;
  reviewJobId?: string;
  reviewTarget?: string;
  review?: RawReview | null;
  status: "analyzing" | "classified" | "reviewing" | "reviewed" | "failed";
  error?: string;
};

const STORE = "v3/requests.json";
export const loadRequests = (): Record<string, SampleRequest> => (exists(STORE) ? readJson(STORE) : {});

async function submit(studio: StudioClient, dir: string) {
  const state = loadState();
  const store = loadRequests();
  const index: Record<string, string> = Object.fromEntries(
    fs
      .readFileSync(path.join(dir, "index.tsv"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t") as [string, string]),
  );
  for (const [key, src] of Object.entries(index)) {
    if (store[key]) continue;
    const filename = path.basename(src);
    const f = await studio.uploadFile(new Blob([fs.readFileSync(path.join(dir, `${key}.pdf`))]), filename);
    const meta = { request: key, purpose: "request-sample" };
    const [ex, cl] = await Promise.all([
      studio.runAgent({ agentId: state.studio.v2ExtractAgentId!, configId: state.studio.v2ExtractConfigId, fileIds: [f.id], metadata: meta }),
      studio.runAgent({ agentId: state.studio.v3ClassifyAgentId!, configId: state.studio.v3ClassifyConfigId, fileIds: [f.id], metadata: meta }),
    ]);
    store[key] = { key, filename, sourcePath: src, fileId: f.id, extractJobId: ex.id, classifyJobId: cl.id, status: "analyzing" };
    writeJson(STORE, store);
    console.log(key, filename);
  }
}

async function collect(studio: StudioClient) {
  const store = loadRequests();
  await pmap(Object.values(store), 4, async (r) => {
    if (r.status === "analyzing") {
      const [ex, cl] = await Promise.all([studio.getResponse(r.extractJobId, "all"), studio.getResponse(r.classifyJobId, "all")]);
      if (RUNNING.includes(ex.status) || RUNNING.includes(cl.status)) return;
      if (ex.status !== "completed" || cl.status !== "completed") {
        r.status = "failed";
        r.error = ex.error?.message ?? cl.error?.message ?? "분석 실패";
        return;
      }
      r.extract = readExtract(ex.output as never);
      const c = readClassify(cl.output as never);
      r.label = c.label;
      r.rationale = c.rationale;
      r.status = "classified";
    }
    if (r.status === "reviewing" && r.reviewJobId) {
      const res = await studio.getResponse(r.reviewJobId, "all");
      if (RUNNING.includes(res.status)) return;
      const x = readReview(res.output as never);
      r.review = x.raw;
      r.status = x.raw ? "reviewed" : "failed";
      if (!x.raw) r.error = res.error?.message ?? "검토 결과 파싱 실패";
    }
  });
  writeJson(STORE, store);
  for (const r of Object.values(store)) console.log(r.key, r.status, r.label, r.rationale?.primary_category_id, r.reviewTarget ?? "", r.error ?? "");
}

async function review(studio: StudioClient, keys: string[]) {
  const state = loadState();
  const store = loadRequests();
  const tax = adaptTaxonomy();
  for (const k of keys) {
    const r = store[k];
    if (!r || r.status !== "classified") continue;
    const type = r.rationale?.primary_category_id ?? r.label!;
    const target = reviewTargetOf(type, tax);
    const job = await studio.runAgent({
      agentId: state.studio.v3ReviewAgentId!,
      configId: state.studio[`v3Review_${target}`],
      fileIds: [r.fileId],
      metadata: { request: k, target, purpose: "request-sample" },
    });
    Object.assign(r, { reviewJobId: job.id, reviewTarget: target, status: "reviewing" });
    console.log(k, type, "→", target, job.id);
  }
  writeJson(STORE, store);
}

async function main() {
  const studio = new StudioClient();
  const [mode, arg] = [process.argv[2], process.argv[3]];
  if (mode === "submit") return submit(studio, arg);
  if (mode === "collect") return collect(studio);
  if (mode === "review") return review(studio, arg.split(","));
  throw new Error("mode: submit <dir> | collect | review r1,r2");
}

if (process.argv[1]?.endsWith("v3-requests.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
