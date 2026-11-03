/**
 * F1 일괄 적재: 샘플 목록의 계약서를 Studio에 업로드하고 적재 Workflow를 실행한다.
 * 중단 후 다시 실행하면 완료된 건은 건너뛰고 이어서 처리한다.
 *
 *   npm run f1:ingest -- --sample data/sample-200.json --limit 3 --concurrency 4
 *
 * 결과
 *   data/f1/extract/<sha>.json  추출 메타데이터 + 신뢰도
 *   data/f1/parse/<sha>.txt     Parse 본문(텍스트) — F2·F4 로컬 분석용
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioClient, StudioApiError, parseStepText } from "@/lib/studio/client";
import type { StudioResponse } from "@/lib/studio/types";
import { dataDir, loadState, saveState, type ContractRecord } from "@/lib/state";

type SampleRow = { path: string; folder: string; pages: number };

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** macOS 파일명(NFD)과 목록(NFC)의 정규화 차이를 흡수해 실제 경로를 찾는다 */
function resolveSource(root: string, rel: string): string {
  let cur = root;
  for (const part of rel.split("/")) {
    const direct = path.join(cur, part);
    if (fs.existsSync(direct)) {
      cur = direct;
      continue;
    }
    const hit = fs.readdirSync(cur).find((n) => n.normalize("NFC") === part.normalize("NFC"));
    if (!hit) throw new Error(`원본을 찾을 수 없음: ${rel}`);
    cur = path.join(cur, hit);
  }
  return cur;
}

function saveOutputs(sha: string, r: StudioResponse) {
  const dir = path.join(dataDir(), "f1");
  fs.mkdirSync(path.join(dir, "extract"), { recursive: true });
  fs.mkdirSync(path.join(dir, "parse"), { recursive: true });
  for (const out of r.output ?? []) {
    const c = out.content?.[0];
    if (!c) continue;
    if (out.step_type === "information-extract") {
      const extra = parseStepText<Record<string, unknown>>(c.additional_values ?? null);
      fs.writeFileSync(
        path.join(dir, "extract", `${sha}.json`),
        JSON.stringify({ jobId: r.id, value: parseStepText(c.text), confidence: extra?.confidence ?? null }, null, 1),
      );
    } else if (out.step_type === "document-parse") {
      fs.writeFileSync(path.join(dir, "parse", `${sha}.txt`), c.text ?? "");
    }
  }
}

/** 동시 작업자 간 경합이 없도록 읽기-수정-쓰기를 동기적으로 한 번에 처리 */
function upsert(rec: ContractRecord) {
  const s = loadState();
  s.contracts[rec.sha256] = rec;
  saveState(s);
}

async function processOne(studio: StudioClient, root: string, row: SampleRow, rec: ContractRecord, agentId: string, configId: string) {
  if (!rec.fileId) {
    const abs = resolveSource(root, row.path);
    const buf = fs.readFileSync(abs);
    const file = await studio.uploadFile(new Blob([buf], { type: "application/pdf" }), path.basename(row.path));
    rec.fileId = file.id;
    rec.status = "uploaded";
    upsert(rec);
  }
  if (!rec.jobId || rec.status === "failed") {
    const job = await studio.runAgent({
      agentId,
      configId,
      fileIds: [rec.fileId!],
      metadata: { sha256: rec.sha256, folder: row.folder.slice(0, 200) },
    });
    rec.jobId = job.id;
    rec.status = "running";
    rec.error = undefined;
    upsert(rec);
  }
  const done = await studio.waitForResponse(rec.jobId!, { include: "all", timeoutMs: 20 * 60_000 });
  rec.status = done.status === "completed" ? "completed" : done.status === "cancelled" ? "cancelled" : "failed";
  rec.error = done.error ? `${done.error.code ?? ""} ${done.error.message ?? ""}`.trim() : undefined;
  if (rec.status === "completed") saveOutputs(rec.sha256, done);
  upsert(rec);
  return rec;
}

async function main() {
  const root = process.env.CONTRACTS_DIR;
  if (!root) throw new Error("CONTRACTS_DIR가 필요합니다");
  const samplePath = arg("sample", path.join(dataDir(), "sample-200.json"))!;
  const limit = Number(arg("limit", "0")) || Infinity;
  const concurrency = Number(arg("concurrency", "4"));

  const state = loadState();
  const { ingestAgentId: agentId, ingestConfigId: configId } = state.studio;
  if (!agentId || !configId) throw new Error("먼저 npm run f1:setup 을 실행하세요");

  const rows = (JSON.parse(fs.readFileSync(samplePath, "utf8")) as SampleRow[]).slice(0, limit);
  const studio = new StudioClient();

  // 작업 목록 구성(sha256으로 중복 제거)
  const queue: Array<{ row: SampleRow; rec: ContractRecord }> = [];
  for (const row of rows) {
    const abs = resolveSource(root, row.path);
    const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    const rec = state.contracts[sha] ?? { path: row.path, folder: row.folder, sha256: sha };
    if (rec.status === "completed" && fs.existsSync(path.join(dataDir(), "f1", "extract", `${sha}.json`))) continue;
    queue.push({ row, rec });
  }
  console.log(`대상 ${rows.length}건 중 처리할 건 ${queue.length}건 (동시 ${concurrency})`);

  let done = 0;
  let failed = 0;
  const started = Date.now();
  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        const r = await processOne(studio, root!, item.row, item.rec, agentId!, configId!);
        if (r.status !== "completed") failed++;
        done++;
        const sec = Math.round((Date.now() - started) / 1000);
        console.log(`[${done}] ${r.status} ${item.row.path} ${r.error ?? ""} (${sec}s)`);
      } catch (e) {
        failed++;
        done++;
        const msg = e instanceof StudioApiError ? e.message : String(e);
        console.error(`[${done}] error ${item.row.path}: ${msg}`);
        upsert({ ...item.rec, status: "failed", error: msg });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`완료: ${done - failed}건 성공, ${failed}건 실패, ${Math.round((Date.now() - started) / 1000)}초`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
