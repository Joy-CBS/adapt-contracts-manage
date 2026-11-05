import { eq, inArray } from "drizzle-orm";
import { type DB, schema } from "@/db";
import type { Category, Extracted, ReviewResult, StandardTemplate } from "@/lib/contracts";

/**
 * 분석 결과 묶음(SeedBundle)을 DB에 적재한다.
 * - 로컬 스크립트(npm run db:seed)와 배포 사이트의 관리 화면(/admin) 업로드가 같은 함수를 쓴다.
 * - 기존 계약서(source=legacy)와 그 검토 결과는 묶음 기준으로 교체한다. Slack 등 다른 경로로 들어온 계약서는 건드리지 않는다.
 */

export type SeedBundle = {
  version: 1;
  generated_at: string;
  categories: Category[];
  templates: StandardTemplate[];
  contracts: Array<{
    sha256: string;
    path: string;
    folder: string;
    filename: string;
    fileId?: string;
    jobId?: string;
    classifyJobId?: string;
    classKey?: string;
    confidence?: number | null;
    metadata: Extracted;
    review?: { jobId: string; classKey: string; verdict?: string; result: ReviewResult; checks?: unknown };
  }>;
};

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function seedBundle(d: DB, b: SeedBundle) {
  if (b.version !== 1) throw new Error("지원하지 않는 묶음 버전");

  // 1) 카테고리: class_key 기준 upsert
  const catId = new Map<string, string>();
  for (const c of b.categories) {
    const values = {
      classKey: c.class_key,
      name: c.name,
      definition: c.definition,
      includeCriteria: c.include_criteria,
      excludeCriteria: c.exclude_criteria,
      standardizable: c.standardizable,
      standardizableReason: c.standardizable_reason,
      origin: "derived" as const,
    };
    const [row] = await d
      .insert(schema.categories)
      .values(values)
      .onConflictDoUpdate({ target: schema.categories.classKey, set: values })
      .returning({ id: schema.categories.id });
    catId.set(c.class_key, row.id);
  }

  // 2) 기존 legacy 계약서·검토 삭제 후 다시 넣는다
  const legacy = await d.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.source, "legacy"));
  for (const ids of chunk(legacy.map((r) => r.id), 200)) await d.delete(schema.reviews).where(inArray(schema.reviews.contractId, ids));
  await d.delete(schema.contracts).where(eq(schema.contracts.source, "legacy"));

  // 3) 표준안: 묶음에 있는 유형의 표준안을 교체
  const tplCats = b.templates.map((t) => catId.get(t.class_key)).filter((x): x is string => !!x);
  if (tplCats.length) {
    await d.delete(schema.reviews).where(
      inArray(
        schema.reviews.templateId,
        d.select({ id: schema.standardTemplates.id }).from(schema.standardTemplates).where(inArray(schema.standardTemplates.categoryId, tplCats)),
      ),
    );
    await d.delete(schema.standardTemplates).where(inArray(schema.standardTemplates.categoryId, tplCats));
  }
  const tplId = new Map<string, string>();
  for (const t of b.templates) {
    const cid = catId.get(t.class_key);
    if (!cid) continue;
    const [row] = await d
      .insert(schema.standardTemplates)
      .values({ categoryId: cid, title: t.title_ko, source: t.source, body: t })
      .returning({ id: schema.standardTemplates.id });
    tplId.set(t.class_key, row.id);
  }

  // 4) 계약서 일괄 입력
  const contractId = new Map<string, string>();
  for (const part of chunk(b.contracts, 50)) {
    const rows = await d
      .insert(schema.contracts)
      .values(
        part.map((c) => ({
          source: "legacy" as const,
          filename: c.filename,
          sourcePath: c.path,
          sourceFolder: c.folder,
          sha256: c.sha256,
          studioFileId: c.fileId,
          studioJobId: c.jobId,
          studioClassifyJobId: c.classifyJobId,
          status: c.review ? ("reviewed" as const) : ("analyzed" as const),
          language: String(c.metadata.language ?? ""),
          categoryId: c.classKey ? catId.get(c.classKey) : undefined,
          classifyConfidence: c.confidence ?? null,
          metadata: c.metadata,
        })),
      )
      .onConflictDoNothing({ target: schema.contracts.sha256 })
      .returning({ id: schema.contracts.id, sha256: schema.contracts.sha256 });
    for (const r of rows) if (r.sha256) contractId.set(r.sha256, r.id);
  }

  // 5) 검토 결과 일괄 입력
  const reviewRows = b.contracts
    .filter((c) => c.review && contractId.has(c.sha256))
    .map((c) => {
      const r = c.review!;
      const sev = (s: string) => r.result.clause_reviews.filter((x) => x.severity === s).length;
      return {
        contractId: contractId.get(c.sha256)!,
        templateId: tplId.get(r.classKey),
        verdict: r.verdict,
        highCount: sev("high"),
        mediumCount: sev("medium"),
        lowCount: sev("low"),
        result: r.result,
        checks: r.checks ?? null,
        studioJobId: r.jobId,
      };
    });
  for (const part of chunk(reviewRows, 25)) await d.insert(schema.reviews).values(part);

  return { categories: catId.size, templates: tplId.size, contracts: contractId.size, reviews: reviewRows.length };
}
