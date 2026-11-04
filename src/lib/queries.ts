import "server-only";
import { and, asc, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Extracted, ReviewResult, StandardTemplate } from "@/lib/contracts";

const { categories, contracts, reviews, standardTemplates } = schema;

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

export async function listCategories() {
  const d = await db();
  const rows = await d
    .select({
      id: categories.id,
      classKey: categories.classKey,
      name: categories.name,
      definition: categories.definition,
      standardizable: categories.standardizable,
      standardizableReason: categories.standardizableReason,
      origin: categories.origin,
      status: categories.status,
      count: sql<number>`count(${contracts.id})::int`,
      high: sql<number>`count(*) filter (where ${reviews.verdict} = 'red')::int`,
      hasTemplate: sql<boolean>`exists(select 1 from standard_templates t where t.category_id = ${categories.id})`,
    })
    .from(categories)
    .leftJoin(contracts, eq(contracts.categoryId, categories.id))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .groupBy(categories.id)
    .orderBy(desc(sql`count(${contracts.id})`));
  return rows;
}

export async function getCategory(classKey: string) {
  const d = await db();
  const [cat] = await d.select().from(categories).where(eq(categories.classKey, classKey));
  if (!cat) return null;
  const [tpl] = await d.select().from(standardTemplates).where(eq(standardTemplates.categoryId, cat.id)).orderBy(desc(standardTemplates.version));
  return { category: cat, template: (tpl?.body as StandardTemplate | undefined) ?? null, templateSource: tpl?.source };
}

export type ContractFilter = { q?: string; category?: string; verdict?: string; language?: string };

export async function listContracts(f: ContractFilter = {}) {
  const d = await db();
  const where: SQL[] = [];
  if (f.q) where.push(ilike(contracts.filename, `%${f.q}%`));
  if (f.category) where.push(eq(categories.classKey, f.category));
  if (f.verdict) where.push(eq(reviews.verdict, f.verdict));
  if (f.language) where.push(eq(contracts.language, f.language));
  const rows = await d
    .select({
      id: contracts.id,
      filename: contracts.filename,
      folder: contracts.sourceFolder,
      source: contracts.source,
      language: contracts.language,
      status: contracts.status,
      confidence: contracts.classifyConfidence,
      metadata: contracts.metadata,
      categoryKey: categories.classKey,
      categoryName: categories.name,
      verdict: reviews.verdict,
      high: reviews.highCount,
      medium: reviews.mediumCount,
      low: reviews.lowCount,
      createdAt: contracts.createdAt,
    })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${reviews.highCount},0)`), desc(sql`coalesce(${reviews.mediumCount},0)`), asc(contracts.filename));
  return rows.map((r) => ({ ...r, metadata: (r.metadata ?? {}) as Extracted }));
}

export async function getContract(id: string) {
  const d = await db();
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await d
    .select({ contract: contracts, category: categories, review: reviews })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(eq(contracts.id, id));
  if (!row) return null;
  let template: StandardTemplate | null = null;
  if (row.review?.templateId) {
    const [t] = await d.select().from(standardTemplates).where(eq(standardTemplates.id, row.review.templateId));
    template = (t?.body as StandardTemplate) ?? null;
  }
  return {
    contract: { ...row.contract, metadata: (row.contract.metadata ?? {}) as Extracted },
    category: row.category,
    review: row.review ? { ...row.review, result: row.review.result as ReviewResult | null } : null,
    template,
  };
}

export async function overview() {
  const d = await db();
  const [c] = await d
    .select({
      contracts: sql<number>`count(*)::int`,
      reviewed: sql<number>`count(${reviews.id})::int`,
      red: sql<number>`count(*) filter (where ${reviews.verdict} = 'red')::int`,
      yellow: sql<number>`count(*) filter (where ${reviews.verdict} = 'yellow')::int`,
      green: sql<number>`count(*) filter (where ${reviews.verdict} = 'green')::int`,
      highRisks: sql<number>`coalesce(sum(${reviews.highCount}),0)::int`,
    })
    .from(contracts)
    .leftJoin(reviews, eq(reviews.contractId, contracts.id));
  const [k] = await d.select({ n: sql<number>`count(*)::int` }).from(categories);
  return { ...c, categories: k.n };
}
