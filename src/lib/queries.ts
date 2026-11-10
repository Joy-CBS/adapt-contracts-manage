import "server-only";
import { and, asc, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Extracted, ReviewResult, StandardTemplate } from "@/lib/contracts";

const { categories, contracts, reviews, standardTemplates } = schema;

function rowsOf<T>(res: unknown): T[] {
  const r = res as { rows?: T[] };
  return (r.rows ?? (res as T[])) as T[];
}

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

export async function listCategories() {
  const d = await db();
  return d
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
      reviewed: sql<number>`count(${reviews.id})::int`,
      red: sql<number>`count(*) filter (where ${reviews.verdict} = 'red')::int`,
      avgHigh: sql<number>`coalesce(avg(${reviews.highCount}), 0)::float`,
      templateStatus: sql<string | null>`(select t.body->>'status' from standard_templates t where t.category_id = ${categories.id} limit 1)`,
      clauseCount: sql<number | null>`(select jsonb_array_length(t.body->'clauses') from standard_templates t where t.category_id = ${categories.id} limit 1)`,
    })
    .from(categories)
    .leftJoin(contracts, eq(contracts.categoryId, categories.id))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .groupBy(categories.id)
    .orderBy(desc(sql`count(${contracts.id})`));
}

export type ClauseStat = {
  classKey: string;
  categoryName: string;
  no: number;
  title: string;
  reviewed: number;
  deviate: number;
  high: number;
  medium: number;
  missing: number;
};

/** 표준안 조항별 일탈 통계(검토 결과 JSON을 조항 단위로 펼쳐 집계) */
export async function clauseStats(classKey?: string): Promise<ClauseStat[]> {
  const d = await db();
  const res = await d.execute(sql`
    with per_cat as (
      select c.category_id, count(*)::int as reviewed
      from reviews r join contracts c on c.id = r.contract_id
      group by c.category_id
    )
    select cat.class_key as "classKey", cat.name as "categoryName",
      (cr->>'standard_clause_no')::int as "no",
      min(cr->>'standard_clause_title') as "title",
      max(pc.reviewed)::int as "reviewed",
      count(*) filter (where cr->>'status' <> '일치')::int as "deviate",
      count(*) filter (where cr->>'severity' = 'high')::int as "high",
      count(*) filter (where cr->>'severity' = 'medium')::int as "medium",
      count(*) filter (where cr->>'status' = '누락')::int as "missing"
    from reviews r
    join contracts c on c.id = r.contract_id
    join categories cat on cat.id = c.category_id
    join per_cat pc on pc.category_id = c.category_id
    cross join lateral jsonb_array_elements(r.result->'clause_reviews') cr
    where (cr->>'standard_clause_no') ~ '^[0-9]+$' and (cr->>'standard_clause_no')::int > 0
    ${classKey ? sql`and cat.class_key = ${classKey}` : sql``}
    group by cat.class_key, cat.name, (cr->>'standard_clause_no')::int
  `);
  return rowsOf<ClauseStat>(res);
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
  return d
    .select({
      id: contracts.id,
      filename: contracts.filename,
      folder: contracts.sourceFolder,
      source: contracts.source,
      language: contracts.language,
      status: contracts.status,
      confidence: contracts.classifyConfidence,
      title: sql<string | null>`${contracts.metadata}->>'contract_title'`,
      counterparty: sql<string | null>`${contracts.metadata}->>'counterparty_name'`,
      counterpartyType: sql<string | null>`${contracts.metadata}->>'counterparty_type'`,
      amount: sql<string | null>`${contracts.metadata}->>'amount'`,
      currency: sql<string | null>`${contracts.metadata}->>'currency'`,
      categoryKey: categories.classKey,
      categoryName: categories.name,
      verdict: reviews.verdict,
      high: reviews.highCount,
      medium: reviews.mediumCount,
      low: reviews.lowCount,
    })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${reviews.highCount},0)`), desc(sql`coalesce(${reviews.mediumCount},0)`), asc(contracts.filename));
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
      avgHigh: sql<number>`coalesce(avg(${reviews.highCount}),0)::float`,
    })
    .from(contracts)
    .leftJoin(reviews, eq(reviews.contractId, contracts.id));
  return c;
}
