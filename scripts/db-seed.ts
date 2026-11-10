/**
 * 로컬 분석 결과(data/)를 묶음으로 만들어 DB에 적재한다. 여러 번 실행해도 같은 결과가 된다.
 *   npm run db:seed                       # DATABASE_URL 없으면 로컬 PGlite에 적재
 *   DATABASE_URL=... npm run db:seed      # Neon(배포) DB에 직접 적재
 *   npm run db:seed -- --bundle-only      # data/seed-bundle.json.gz만 생성 (배포 사이트 /admin에서 업로드)
 *
 * v2: 어댑트 분류체계·플레이북 기준, 추론 모델 solar-pro4 결과로 묶는다.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { db, migrateDb } from "@/db";
import { extracted, readJson } from "@/lib/contracts";
import { type SeedBundle, seedBundle } from "@/lib/seed";
import { dataDir, loadState } from "@/lib/state";
import { BUCKETS, OTHERS_KEY, bucketOf } from "@/lib/buckets";
import { type StandardDocV2, assessClassification, finalizeReview, verdictOf } from "@/lib/review-types";
import { allChecklists, checklistFor } from "./lib/checklist";
import { adaptTaxonomy, bucketEstimate, bucketName, frontmatter, playbook, playbookSection } from "./lib/adapt-kb";
import { loadClassify } from "./v2-classify";
import { loadExtract } from "./v2-extract";
import { loadReview } from "./v2-review";

function standardDoc(bucket: string, standardId: string): StandardDocV2 {
  const md = playbook(standardId);
  const fm = frontmatter(md);
  const std = readJson<{ title: string; sourceFile: string; paragraphs: StandardDocV2["paragraphs"] }>(`v2/standards/${standardId}.json`);
  // 화면의 조항 목록 = 검토 체크리스트(검토 결과 항목 이름과 같다)
  const clauses = checklistFor(BUCKETS.find((b) => b.key === bucket)!).map((e) => ({ title: e.title, grade: e.grade }));
  const checklist = playbookSection(md, 3)
    .split("\n")
    .filter((l) => /^\s*(\d+\.|-)\s+/.test(l))
    .map((l) => l.replace(/^\s*(\d+\.|-)\s+/, "").trim());
  const docx = fs.readFileSync(path.join(dataDir(), "adapt", "standards", std.sourceFile));
  return {
    kind: "adapt_docx",
    bucket,
    standardId,
    title: std.title,
    sourceFile: std.sourceFile,
    version: fm.version ?? "",
    paragraphs: std.paragraphs,
    clauses,
    checklist,
    docxBase64: docx.toString("base64"),
  };
}

export function buildBundle(): SeedBundle {
  const tax = adaptTaxonomy();
  const nameOf = (id: string) => (BUCKETS.some((b) => b.key === id) ? bucketName(id) : (tax.find((c) => c.category_id === id)?.name_ko ?? id));
  const cls = loadClassify("sp4");
  const ext = loadExtract();
  const rev = loadReview("sp4");
  const checklists = allChecklists();
  const state = loadState();

  const byId = new Map(tax.map((c) => [c.category_id, c]));
  const categories = BUCKETS.map((b, i) => {
    const t = byId.get(b.key);
    return {
      key: b.key,
      name: bucketName(b.key),
      definition:
        t?.definition ??
        `상위 5개 유형 외의 모든 계약(${tax.filter((c) => bucketOf(c.category_id) === OTHERS_KEY).length}종). 유형별 플레이북 없이 01_COMMON_POSITIONS(전 표준 공통 기준)까지 검토합니다.`,
      includeSignals: t?.include_signals ?? [],
      excludeSignals: t?.exclude_signals ?? [],
      standardId: b.standardId,
      hasStandard: b.hasStandard,
      estimate: b.key === OTHERS_KEY ? null : bucketEstimate(b.key),
      sortOrder: i,
    };
  });
  const subtypes = tax.map((c) => ({
    id: c.category_id,
    nameKo: c.name_ko,
    group: c.group,
    standardId: c.standard_id,
    status: c.status,
    definition: c.definition,
    includeSignals: c.include_signals,
    excludeSignals: c.exclude_signals,
    bucket: bucketOf(c.category_id),
  }));
  const standards = BUCKETS.filter((b) => b.hasStandard && b.standardId).map((b) => standardDoc(b.key, b.standardId!));
  const studio: Record<string, string> = { "v2.review.agent": state.studio.v2ReviewAgentId ?? "" };
  for (const b of BUCKETS) studio[`v2.review.config.${b.key}`] = state.studio[`v2Review_${b.key}_sp4`] ?? "";

  const contracts = Object.values(state.contracts)
    .filter((r) => r.status === "completed" && cls[r.sha256]?.status === "completed")
    .map((r) => {
      const c = cls[r.sha256];
      const classification = assessClassification({ model: "solar-pro4", label: c.label ?? OTHERS_KEY, rationale: c.rationale ?? null, confidence: c.confidence, nameOf });
      const bucket = classification.suggested;
      const rv = rev[r.sha256];
      const sp4 = ext[r.sha256];
      const metadata = sp4?.status === "completed" && sp4.value ? sp4.value : extracted(r.sha256);
      let review: SeedBundle["contracts"][number]["review"];
      if (rv?.status === "completed" && rv.result) {
        const result = finalizeReview(rv.result, checklists[rv.bucket] ?? []);
        review = { jobId: rv.jobId, bucket: rv.bucket, model: "solar-pro4", verdict: verdictOf(result.items, result.is_high_value), result, checks: rv.checks };
      }
      return {
        sha256: r.sha256,
        path: r.path,
        folder: r.folder,
        filename: path.basename(r.path),
        fileId: r.fileId,
        jobId: sp4?.jobId ?? r.jobId,
        classifyJobId: c.jobId,
        bucket,
        subtypeId: c.rationale?.primary_category_id ?? null,
        classification,
        metadata,
        review,
      };
    });
  return { version: 2, generated_at: new Date().toISOString(), model: "solar-pro4", categories, subtypes, standards, checklists, studio, contracts };
}

async function main() {
  const bundle = buildBundle();
  const out = path.join(dataDir(), "seed-bundle.json.gz");
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(bundle)));
  console.log(`묶음 생성: ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)}MB, 계약서 ${bundle.contracts.length}, 검토 ${bundle.contracts.filter((c) => c.review).length})`);
  if (process.argv.includes("--bundle-only")) return;
  await migrateDb();
  const r = await seedBundle(await db(), bundle);
  console.log(r);
}

if (process.argv[1]?.endsWith("db-seed.ts")) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}


