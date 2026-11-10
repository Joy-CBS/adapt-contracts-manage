import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Extracted } from "@/lib/contracts";
import type { Classification, ReviewV2, StandardDocV2 } from "@/lib/review-types";

const { categories, contracts, reviews, standardTemplates, reviewItemStates } = schema;

function rowsOf<T>(res: unknown): T[] {
  const r = res as { rows?: T[] };
  return (r.rows ?? (res as T[])) as T[];
}

/* ---------- 유형(카테고리) ---------- */

export type CategoryOption = { key: string; name: string; group: string | null; hasStandard: boolean; standardId: string | null; status: string | null };

export async function categoryOptions(): Promise<CategoryOption[]> {
  const d = await db();
  return d
    .select({
      key: categories.classKey,
      name: categories.name,
      group: categories.group,
      hasStandard: categories.hasStandard,
      standardId: categories.standardId,
      status: categories.taxonomyStatus,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

/* ---------- 검토 요청 ---------- */

const lawyerCounts = {
  lawyerOpen: sql<number>`coalesce((select count(*) from jsonb_array_elements(${reviews.result}->'items') with ordinality e(it, n)
      where it->>'decision' = 'needs_lawyer'
      and not exists (select 1 from review_item_states s where s.review_id = ${reviews.id} and s.item_index = e.n - 1 and s.status <> 'open')), 0)::int`,
  lawyerRequested: sql<number>`coalesce((select count(*) from review_item_states s where s.review_id = ${reviews.id} and s.status = 'requested'), 0)::int`,
  lawyerAnswered: sql<number>`coalesce((select count(*) from review_item_states s where s.review_id = ${reviews.id} and s.status = 'answered'), 0)::int`,
};

export type RequestRow = Awaited<ReturnType<typeof listRequests>>[number];

export async function listRequests() {
  const d = await db();
  return d
    .select({
      id: contracts.id,
      filename: contracts.filename,
      stage: contracts.stage,
      requestedAt: contracts.requestedAt,
      completedAt: contracts.completedAt,
      note: contracts.requestNote,
      level: sql<string | null>`${contracts.classification}->>'level'`,
      title: sql<string | null>`${contracts.metadata}->>'contract_title'`,
      counterparty: sql<string | null>`${contracts.metadata}->>'counterparty_name'`,
      categoryName: categories.name,
      hasStandard: categories.hasStandard,
      verdict: reviews.verdict,
      risk: reviews.riskCount,
      lawyer: reviews.lawyerCount,
      ...lawyerCounts,
    })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(inArray(contracts.source, ["upload", "slack"]))
    .orderBy(desc(contracts.requestedAt));
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
  let standard: StandardDocV2 | null = null;
  const tplWhere = row.review?.templateId
    ? eq(standardTemplates.id, row.review.templateId)
    : row.category?.hasStandard
      ? eq(standardTemplates.categoryId, row.category.id)
      : null;
  if (tplWhere) {
    const [t] = await d.select().from(standardTemplates).where(tplWhere);
    standard = (t?.body as StandardDocV2)?.kind === "adapt_docx" ? (t!.body as StandardDocV2) : null;
  }
  const states = row.review ? await d.select().from(reviewItemStates).where(eq(reviewItemStates.reviewId, row.review.id)) : [];
  return {
    contract: { ...row.contract, metadata: (row.contract.metadata ?? {}) as Extracted, classification: row.contract.classification as Classification | null },
    category: row.category,
    review: row.review && row.review.schemaVersion === 2 ? { ...row.review, result: row.review.result as ReviewV2 } : null,
    standard,
    states: new Map(states.map((s) => [s.itemIndex, s])),
  };
}

/* ---------- 계약서 보관함 ---------- */

export async function archiveTypes() {
  const d = await db();
  return rowsOf<{ key: string; name: string; group: string | null; hasStandard: boolean; standardId: string | null; status: string | null; n: number; check: number }>(
    await d.execute(sql`
      select cat.class_key as key, cat.name, cat."group", cat.has_standard as "hasStandard", cat.standard_id as "standardId", cat.taxonomy_status as status,
        count(c.id)::int as n, count(c.id) filter (where c.classify_state = 'suggested')::int as "check"
      from categories cat join contracts c on c.category_id = cat.id and c.source = 'legacy'
      group by cat.id order by count(c.id) desc`),
  );
}

export async function archiveList(f: { type?: string; q?: string; check?: boolean }) {
  const d = await db();
  const where: SQL[] = [eq(contracts.source, "legacy")];
  if (f.type) where.push(eq(categories.classKey, f.type));
  if (f.check) where.push(eq(contracts.classifyState, "suggested"));
  if (f.q) where.push(or(ilike(contracts.filename, `%${f.q}%`), sql`${contracts.metadata}->>'counterparty_name' ilike ${`%${f.q}%`}`)!);
  return d
    .select({
      id: contracts.id,
      filename: contracts.filename,
      classifyState: contracts.classifyState,
      title: sql<string | null>`${contracts.metadata}->>'contract_title'`,
      counterparty: sql<string | null>`${contracts.metadata}->>'counterparty_name'`,
      signed: sql<string | null>`${contracts.metadata}->>'signed_date'`,
      amount: sql<string | null>`${contracts.metadata}->>'amount'`,
      currency: sql<string | null>`${contracts.metadata}->>'currency'`,
      categoryName: categories.name,
      verdict: reviews.verdict,
      risk: reviews.riskCount,
      lawyer: reviews.lawyerCount,
    })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(and(...where))
    .orderBy(desc(sql`${contracts.metadata}->>'signed_date'`), asc(contracts.filename));
}

export async function archiveTotals() {
  const d = await db();
  const [r] = rowsOf<{ total: number; standard: number; noStandard: number; check: number }>(
    await d.execute(sql`
      select count(*)::int as total,
        count(*) filter (where cat.has_standard)::int as standard,
        count(*) filter (where not cat.has_standard)::int as "noStandard",
        count(*) filter (where c.classify_state = 'suggested')::int as "check"
      from contracts c left join categories cat on cat.id = c.category_id where c.source = 'legacy'`),
  );
  return r ?? { total: 0, standard: 0, noStandard: 0, check: 0 };
}

/* ---------- 표준계약서 ---------- */

export async function standardsOverview() {
  const d = await db();
  return rowsOf<{
    key: string;
    name: string;
    group: string | null;
    hasStandard: boolean;
    standardId: string | null;
    status: string | null;
    estimate: number | null;
    n: number;
    reviewed: number;
    deviating: number;
  }>(
    await d.execute(sql`
      select cat.class_key as key, cat.name, cat."group", cat.has_standard as "hasStandard", cat.standard_id as "standardId",
        cat.taxonomy_status as status, cat.estimate,
        count(c.id)::int as n, count(r.id)::int as reviewed,
        count(r.id) filter (where r.risk_count > 0)::int as deviating
      from categories cat
      left join contracts c on c.category_id = cat.id and c.source = 'legacy'
      left join reviews r on r.contract_id = c.id
      group by cat.id
      order by cat.sort_order, cat.name`),
  );
}

export type ClauseStat = { clause: string; reviewed: number; risk: number; lawyer: number; note: number; ok: number; missing: number };

export async function clauseStats(classKey: string): Promise<ClauseStat[]> {
  const d = await db();
  return rowsOf<ClauseStat>(
    await d.execute(sql`
      with rv as (
        select r.result from reviews r join contracts c on c.id = r.contract_id join categories cat on cat.id = c.category_id
        where cat.class_key = ${classKey} and r.schema_version = 2
      )
      select it->>'clause_ref' as "clause",
        (select count(*) from rv)::int as "reviewed",
        count(*) filter (where it->>'decision' = 'risk')::int as "risk",
        count(*) filter (where it->>'decision' = 'needs_lawyer')::int as "lawyer",
        count(*) filter (where it->>'decision' = 'note')::int as "note",
        count(*) filter (where it->>'decision' = 'ok')::int as "ok",
        count(*) filter (where it->>'finding' = '누락')::int as "missing"
      from rv cross join lateral jsonb_array_elements(rv.result->'items') it
      group by it->>'clause_ref'`),
  );
}

export async function getStandard(classKey: string) {
  const d = await db();
  const [cat] = await d.select().from(categories).where(eq(categories.classKey, classKey));
  if (!cat) return null;
  const [tpl] = await d.select().from(standardTemplates).where(eq(standardTemplates.categoryId, cat.id));
  return { category: cat, standard: (tpl?.body as StandardDocV2)?.kind === "adapt_docx" ? (tpl!.body as StandardDocV2) : null };
}

export async function requestCounts() {
  const rows = await listRequests();
  return rows;
}
