/**
 * 로컬 분석 결과(data/)를 묶음으로 만들어 DB에 적재한다. 여러 번 실행해도 같은 결과가 된다.
 *   npm run db:seed                       # DATABASE_URL 없으면 로컬 PGlite에 적재
 *   DATABASE_URL=... npm run db:seed      # Neon(배포) DB에 직접 적재
 *   npm run db:seed -- --bundle-only      # data/seed-bundle.json.gz만 생성 (배포 사이트 /admin에서 업로드)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { db, migrateDb } from "@/db";
import { type Category, type ReviewResult, type StandardTemplate, exists, extracted, readJson } from "@/lib/contracts";
import { type SeedBundle, seedBundle } from "@/lib/seed";
import { dataDir, loadState } from "@/lib/state";

type Taxonomy = { categories: Category[] };
type ClassifyRun = { jobId: string; label?: string; confidence?: { document_type?: { confidence_score?: number } } };
type ReviewRun = { jobId: string; class_key: string; status: string; verdict?: string; result?: ReviewResult; checks?: unknown };

export function buildBundle(): SeedBundle {
  const tax = readJson<Taxonomy>("f2/taxonomy.json");
  const classify = exists("f2/classify.json") ? readJson<Record<string, ClassifyRun>>("f2/classify.json") : {};
  const reviews = exists("f4/reviews.json") ? readJson<Record<string, ReviewRun>>("f4/reviews.json") : {};
  const state = loadState();
  const templates = tax.categories
    .filter((c) => exists(`f2/templates/${c.class_key}.json`))
    .map((c) => readJson<StandardTemplate>(`f2/templates/${c.class_key}.json`));
  const contracts = Object.values(state.contracts)
    .filter((r) => r.status === "completed")
    .map((r) => {
      const cls = classify[r.sha256];
      const rv = reviews[r.sha256];
      return {
        sha256: r.sha256,
        path: r.path,
        folder: r.folder,
        filename: path.basename(r.path),
        fileId: r.fileId,
        jobId: r.jobId,
        classifyJobId: cls?.jobId,
        classKey: cls?.label,
        confidence: cls?.confidence?.document_type?.confidence_score ?? null,
        metadata: extracted(r.sha256),
        review:
          rv?.status === "completed" && rv.result
            ? { jobId: rv.jobId, classKey: rv.class_key, verdict: rv.verdict, result: rv.result, checks: rv.checks }
            : undefined,
      };
    });
  return { version: 1, generated_at: new Date().toISOString(), categories: tax.categories, templates, contracts };
}

async function main() {
  const bundle = buildBundle();
  const out = path.join(dataDir(), "seed-bundle.json.gz");
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(bundle)));
  console.log(`묶음 생성: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)}MB)`);
  if (process.argv.includes("--bundle-only")) return;
  await migrateDb();
  const r = await seedBundle(await db(), bundle);
  console.log(`카테고리 ${r.categories}, 표준안 ${r.templates}, 계약서 ${r.contracts}, 검토 ${r.reviews}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
