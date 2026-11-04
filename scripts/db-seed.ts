/**
 * 로컬 분석 결과(data/)를 앱 DB에 적재한다. 여러 번 실행해도 같은 결과가 된다.
 *   npm run db:seed                  # DATABASE_URL 없으면 로컬 PGlite
 *   DATABASE_URL=... npm run db:seed # Vercel(Neon) DB에 적재
 */
import "dotenv/config";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, migrateDb, schema } from "@/db";
import { type Category, type ReviewResult, type StandardTemplate, exists, extracted, readJson } from "@/lib/contracts";
import { loadState } from "@/lib/state";

type Taxonomy = { index: Array<{ id: number; sha256: string }>; categories: Category[] };
type ClassifyRun = { jobId: string; label?: string; confidence?: { document_type?: { confidence_score?: number } } };
type ReviewRun = { jobId: string; class_key: string; status: string; verdict?: string; result?: ReviewResult; checks?: unknown };

async function main() {
  await migrateDb();
  const d = await db();
  const tax = readJson<Taxonomy>("f2/taxonomy.json");
  const classify = exists("f2/classify.json") ? readJson<Record<string, ClassifyRun>>("f2/classify.json") : {};
  const reviews = exists("f4/reviews.json") ? readJson<Record<string, ReviewRun>>("f4/reviews.json") : {};
  const state = loadState();

  // 카테고리
  const catId = new Map<string, string>();
  for (const c of tax.categories) {
    const values = {
      classKey: c.class_key,
      name: c.name,
      definition: c.definition,
      includeCriteria: c.include_criteria,
      excludeCriteria: c.exclude_criteria,
      standardizable: c.standardizable,
      standardizableReason: c.standardizable_reason,
      origin: "derived" as const,
      status: "draft" as const,
    };
    const [row] = await d
      .insert(schema.categories)
      .values(values)
      .onConflictDoUpdate({ target: schema.categories.classKey, set: values })
      .returning({ id: schema.categories.id });
    catId.set(c.class_key, row.id);
  }

  // 표준안
  const tplId = new Map<string, string>();
  for (const c of tax.categories) {
    if (!exists(`f2/templates/${c.class_key}.json`)) continue;
    const t = readJson<StandardTemplate>(`f2/templates/${c.class_key}.json`);
    const cid = catId.get(c.class_key)!;
    const old = await d.select({ id: schema.standardTemplates.id }).from(schema.standardTemplates).where(eq(schema.standardTemplates.categoryId, cid));
    if (old.length) {
      await d.update(schema.standardTemplates).set({ title: t.title_ko, source: t.source, body: t }).where(eq(schema.standardTemplates.id, old[0].id));
      tplId.set(c.class_key, old[0].id);
    } else {
      const [row] = await d.insert(schema.standardTemplates).values({ categoryId: cid, title: t.title_ko, source: t.source, body: t }).returning({ id: schema.standardTemplates.id });
      tplId.set(c.class_key, row.id);
    }
  }

  // 계약서 + 검토
  let nContracts = 0;
  let nReviews = 0;
  for (const rec of Object.values(state.contracts)) {
    if (rec.status !== "completed") continue;
    const meta = extracted(rec.sha256);
    const cls = classify[rec.sha256];
    const rv = reviews[rec.sha256];
    const values = {
      source: "legacy" as const,
      filename: path.basename(rec.path),
      sourcePath: rec.path,
      sourceFolder: rec.folder,
      sha256: rec.sha256,
      studioFileId: rec.fileId,
      studioJobId: rec.jobId,
      studioClassifyJobId: cls?.jobId,
      status: rv?.status === "completed" ? ("reviewed" as const) : ("analyzed" as const),
      language: String(meta.language ?? ""),
      categoryId: cls?.label ? catId.get(cls.label) : undefined,
      classifyConfidence: cls?.confidence?.document_type?.confidence_score ?? null,
      metadata: meta,
      updatedAt: new Date(),
    };
    const [row] = await d
      .insert(schema.contracts)
      .values(values)
      .onConflictDoUpdate({ target: schema.contracts.sha256, set: values })
      .returning({ id: schema.contracts.id });
    nContracts++;
    if (rv?.status === "completed" && rv.result) {
      await d.delete(schema.reviews).where(inArray(schema.reviews.contractId, [row.id]));
      const sev = (s: string) => rv.result!.clause_reviews.filter((x) => x.severity === s).length;
      await d.insert(schema.reviews).values({
        contractId: row.id,
        templateId: tplId.get(rv.class_key),
        verdict: rv.verdict,
        highCount: sev("high"),
        mediumCount: sev("medium"),
        lowCount: sev("low"),
        result: rv.result,
        checks: rv.checks ?? null,
        studioJobId: rv.jobId,
      });
      nReviews++;
    }
  }
  console.log(`카테고리 ${catId.size}, 표준안 ${tplId.size}, 계약서 ${nContracts}, 검토 ${nReviews}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
