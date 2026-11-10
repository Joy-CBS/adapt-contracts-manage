import "server-only";
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Extracted } from "@/lib/contracts";
import type { Classification, ReviewV2, StandardDocV2 } from "@/lib/review-types";

const { categories, contracts, reviews, standardTemplates, reviewItemStates, subtypes } = schema;

function rowsOf<T>(res: unknown): T[] {
  const r = res as { rows?: T[] };
  return (r.rows ?? (res as T[])) as T[];
}

/* ---------- 검토 범위(유형) ---------- */

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

export async function listCategories() {
  const d = await db();
  return d
    .select({
      id: categories.id,
      classKey: categories.classKey,
      name: categories.name,
      definition: categories.definition,
      standardId: categories.standardId,
      hasStandard: categories.hasStandard,
      estimate: categories.estimate,
      sortOrder: categories.sortOrder,
      count: sql<number>`count(${contracts.id})::int`,
      reviewed: sql<number>`count(${reviews.id})::int`,
      approved: sql<number>`count(*) filter (where ${contracts.classifyState} <> 'suggested')::int`,
      red: sql<number>`count(*) filter (where ${reviews.verdict} = 'red')::int`,
      yellow: sql<number>`count(*) filter (where ${reviews.verdict} = 'yellow')::int`,
      green: sql<number>`count(*) filter (where ${reviews.verdict} = 'green')::int`,
      risk: sql<number>`coalesce(sum(${reviews.riskCount}),0)::int`,
      lawyer: sql<number>`coalesce(sum(${reviews.lawyerCount}),0)::int`,
    })
    .from(categories)
    .leftJoin(contracts, eq(contracts.categoryId, categories.id))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder));
}

export async function categoryOptions() {
  const d = await db();
  return d.select({ key: categories.classKey, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder));
}

export type ClauseStat = { clause: string; reviewed: number; risk: number; lawyer: number; note: number; ok: number; missing: number };

/** 검토 기준 항목(플레이북 조항·공통 포지션)별 집계 */
export async function clauseStats(classKey: string): Promise<ClauseStat[]> {
  const d = await db();
  const res = await d.execute(sql`
    with rv as (
      select r.result from reviews r join contracts c on c.id = r.contract_id join categories cat on cat.id = c.category_id
      where cat.class_key = ${classKey} and r.schema_version = 2 and r.bucket = ${classKey}
    )
    select it->>'clause_ref' as "clause",
      (select count(*) from rv)::int as "reviewed",
      count(*) filter (where it->>'decision' = 'risk')::int as "risk",
      count(*) filter (where it->>'decision' = 'needs_lawyer')::int as "lawyer",
      count(*) filter (where it->>'decision' = 'note')::int as "note",
      count(*) filter (where it->>'decision' = 'ok')::int as "ok",
      count(*) filter (where it->>'finding' = '누락')::int as "missing"
    from rv cross join lateral jsonb_array_elements(rv.result->'items') it
    group by it->>'clause_ref'
    order by count(*) filter (where it->>'decision' in ('risk','needs_lawyer')) desc
  `);
  return rowsOf<ClauseStat>(res);
}

export async function getCategory(classKey: string) {
  const d = await db();
  const [cat] = await d.select().from(categories).where(eq(categories.classKey, classKey));
  if (!cat) return null;
  const [tpl] = await d.select().from(standardTemplates).where(eq(standardTemplates.categoryId, cat.id)).orderBy(desc(standardTemplates.version));
  const subs = await d.select().from(subtypes).where(eq(subtypes.bucket, classKey));
  const subCounts = rowsOf<{ id: string; n: number }>(
    await d.execute(sql`select c.subtype_id as id, count(*)::int as n from contracts c join categories cat on cat.id = c.category_id where cat.class_key = ${classKey} group by c.subtype_id`),
  );
  return { category: cat, standard: (tpl?.body as StandardDocV2 | undefined)?.kind === "adapt_docx" ? (tpl!.body as StandardDocV2) : null, subtypes: subs, subCounts };
}

export async function subtypeNames() {
  const d = await db();
  const rows = await d.select({ id: subtypes.id, name: subtypes.nameKo }).from(subtypes);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ---------- 계약서 ---------- */

export type ContractFilter = { q?: string; category?: string; verdict?: string; state?: string; level?: string };

const listColumns = {
  id: contracts.id,
  filename: contracts.filename,
  folder: contracts.sourceFolder,
  source: contracts.source,
  language: contracts.language,
  classifyState: contracts.classifyState,
  needsReReview: contracts.needsReReview,
  level: sql<string | null>`${contracts.classification}->>'level'`,
  subtypeId: contracts.subtypeId,
  title: sql<string | null>`${contracts.metadata}->>'contract_title'`,
  counterparty: sql<string | null>`${contracts.metadata}->>'counterparty_name'`,
  amount: sql<string | null>`${contracts.metadata}->>'amount'`,
  currency: sql<string | null>`${contracts.metadata}->>'currency'`,
  categoryKey: categories.classKey,
  categoryName: categories.name,
  reviewId: reviews.id,
  verdict: reviews.verdict,
  risk: reviews.riskCount,
  riskHigh: reviews.highCount,
  lawyer: reviews.lawyerCount,
  lawyerOpen: sql<number>`(select count(*) from jsonb_array_elements(${reviews.result}->'items') with ordinality e(it, n)
      where it->>'decision' = 'needs_lawyer'
      and not exists (select 1 from review_item_states s where s.review_id = ${reviews.id} and s.item_index = e.n - 1 and s.status <> 'open'))::int`,
  lawyerRequested: sql<number>`(select count(*) from review_item_states s where s.review_id = ${reviews.id} and s.status = 'requested')::int`,
};

export async function listContracts(f: ContractFilter = {}) {
  const d = await db();
  const where: SQL[] = [];
  if (f.q) where.push(ilike(contracts.filename, `%${f.q}%`));
  if (f.category) where.push(eq(categories.classKey, f.category));
  if (f.verdict) where.push(eq(reviews.verdict, f.verdict));
  if (f.state === "pending") where.push(eq(contracts.classifyState, "suggested"));
  if (f.state === "decided") where.push(sql`${contracts.classifyState} <> 'suggested'`);
  if (f.state === "rereview") where.push(eq(contracts.needsReReview, true));
  if (f.level) where.push(sql`${contracts.classification}->>'level' = ${f.level}`);
  return d
    .select(listColumns)
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(
      sql`case ${reviews.verdict} when 'red' then 0 when 'yellow' then 1 when 'green' then 2 else 3 end`,
      desc(sql`coalesce(${reviews.highCount},0)`),
      desc(sql`coalesce(${reviews.lawyerCount},0)`),
      asc(contracts.filename),
    );
}

/** 분류 확인 대기열: 근거가 약한 것부터 */
export async function classifyQueue() {
  const d = await db();
  return d
    .select({ ...listColumns, classification: contracts.classification })
    .from(contracts)
    .leftJoin(categories, eq(categories.id, contracts.categoryId))
    .leftJoin(reviews, eq(reviews.contractId, contracts.id))
    .where(eq(contracts.classifyState, "suggested"))
    .orderBy(
      sql`case ${contracts.classification}->>'level' when 'weak' then 0 when 'medium' then 1 else 2 end`,
      asc(categories.sortOrder),
      asc(contracts.filename),
    );
}

export type LawyerItem = {
  reviewId: string;
  contractId: string;
  filename: string;
  counterparty: string | null;
  categoryName: string | null;
  itemIndex: number;
  item: ReviewV2["items"][number];
  status: "open" | "requested" | "answered";
  requestNote: string | null;
  resolution: string | null;
  answerNote: string | null;
  requestedAt: string | null;
  answeredAt: string | null;
};

/** 변호사 확인 항목(전체 계약). status로 거른다 */
export async function lawyerItems(status?: "open" | "requested" | "answered"): Promise<LawyerItem[]> {
  const d = await db();
  const res = await d.execute(sql`
    select r.id as "reviewId", c.id as "contractId", c.filename, c.metadata->>'counterparty_name' as counterparty, cat.name as "categoryName",
      (e.n - 1)::int as "itemIndex", e.it as item,
      coalesce(s.status::text, 'open') as status, s.request_note as "requestNote", s.resolution, s.answer_note as "answerNote",
      s.requested_at as "requestedAt", s.answered_at as "answeredAt"
    from reviews r
    join contracts c on c.id = r.contract_id
    left join categories cat on cat.id = c.category_id
    cross join lateral jsonb_array_elements(r.result->'items') with ordinality e(it, n)
    left join review_item_states s on s.review_id = r.id and s.item_index = e.n - 1
    where e.it->>'decision' = 'needs_lawyer'
      ${status ? sql`and coalesce(s.status::text, 'open') = ${status}` : sql``}
    order by case e.it->>'severity' when 'high' then 0 when 'medium' then 1 else 2 end, c.filename, e.n
  `);
  return rowsOf<LawyerItem>(res);
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
  if (row.review?.templateId) {
    const [t] = await d.select().from(standardTemplates).where(eq(standardTemplates.id, row.review.templateId));
    standard = (t?.body as StandardDocV2)?.kind === "adapt_docx" ? (t!.body as StandardDocV2) : null;
  }
  const states = row.review ? await d.select().from(reviewItemStates).where(eq(reviewItemStates.reviewId, row.review.id)) : [];
  const subtype = row.contract.subtypeId ? (await d.select().from(subtypes).where(eq(subtypes.id, row.contract.subtypeId)))[0] ?? null : null;
  return {
    contract: { ...row.contract, metadata: (row.contract.metadata ?? {}) as Extracted, classification: row.contract.classification as Classification | null },
    category: row.category,
    subtype,
    review: row.review && row.review.schemaVersion === 2 ? { ...row.review, result: row.review.result as ReviewV2 } : null,
    standard,
    states: new Map(states.map((s) => [s.itemIndex, s])),
  };
}

export async function getContractsByIds(ids: string[]) {
  const d = await db();
  if (!ids.length) return [];
  return d.select().from(contracts).where(inArray(contracts.id, ids));
}

/* ---------- 대시보드 ---------- */

export async function overview() {
  const d = await db();
  const [c] = await d
    .select({
      contracts: sql<number>`count(*)::int`,
      reviewed: sql<number>`count(${reviews.id})::int`,
      red: sql<number>`count(*) filter (where ${reviews.verdict} = 'red')::int`,
      yellow: sql<number>`count(*) filter (where ${reviews.verdict} = 'yellow')::int`,
      green: sql<number>`count(*) filter (where ${reviews.verdict} = 'green')::int`,
      pending: sql<number>`count(*) filter (where ${contracts.classifyState} = 'suggested')::int`,
      pendingStrong: sql<number>`count(*) filter (where ${contracts.classifyState} = 'suggested' and ${contracts.classification}->>'level' = 'strong')::int`,
      pendingWeak: sql<number>`count(*) filter (where ${contracts.classifyState} = 'suggested' and ${contracts.classification}->>'level' = 'weak')::int`,
      rereview: sql<number>`count(*) filter (where ${contracts.needsReReview})::int`,
      riskContracts: sql<number>`count(*) filter (where ${reviews.riskCount} > 0)::int`,
    })
    .from(contracts)
    .leftJoin(reviews, eq(reviews.contractId, contracts.id));
  const [l] = rowsOf<{ open: number; openContracts: number; requested: number; answered: number }>(
    await d.execute(sql`
      select count(*) filter (where coalesce(s.status::text,'open') = 'open')::int as open,
        count(distinct r.id) filter (where coalesce(s.status::text,'open') = 'open')::int as "openContracts",
        count(*) filter (where s.status = 'requested')::int as requested,
        count(*) filter (where s.status = 'answered')::int as answered
      from reviews r cross join lateral jsonb_array_elements(r.result->'items') with ordinality e(it, n)
      left join review_item_states s on s.review_id = r.id and s.item_index = e.n - 1
      where e.it->>'decision' = 'needs_lawyer'`),
  );
  /** 검토 완료 = 분류 확정 + 변호사 확인 항목이 모두 답변됨 + 재검토 대기 아님 */
  const [done] = rowsOf<{ n: number }>(
    await d.execute(sql`
      select count(*)::int as n from contracts c join reviews r on r.contract_id = c.id
      where c.classify_state <> 'suggested' and not c.needs_re_review
      and not exists (select 1 from jsonb_array_elements(r.result->'items') with ordinality e(it, n)
        left join review_item_states s on s.review_id = r.id and s.item_index = e.n - 1
        where e.it->>'decision' = 'needs_lawyer' and coalesce(s.status::text,'open') <> 'answered')`),
  );
  return { ...c, lawyer: l ?? { open: 0, openContracts: 0, requested: 0, answered: 0 }, done: done?.n ?? 0 };
}

/** 여러 계약에서 자주 걸리는 검토 항목(수정 필요·변호사 확인) */
export async function hotClauses(limit = 6) {
  const d = await db();
  return rowsOf<{ classKey: string; categoryName: string; clause: string; n: number; reviewed: number; risk: number; lawyer: number }>(
    await d.execute(sql`
      with per as (select c.category_id, count(*)::int as reviewed from reviews r join contracts c on c.id = r.contract_id group by c.category_id)
      select cat.class_key as "classKey", cat.name as "categoryName", it->>'clause_ref' as clause,
        count(*)::int as n, max(per.reviewed)::int as reviewed,
        count(*) filter (where it->>'decision' = 'risk')::int as risk,
        count(*) filter (where it->>'decision' = 'needs_lawyer')::int as lawyer
      from reviews r join contracts c on c.id = r.contract_id join categories cat on cat.id = c.category_id join per on per.category_id = c.category_id
      cross join lateral jsonb_array_elements(r.result->'items') it
      where it->>'decision' in ('risk','needs_lawyer') and r.bucket = cat.class_key
      group by cat.class_key, cat.name, it->>'clause_ref'
      having max(per.reviewed) >= 3
      order by count(*)::float / max(per.reviewed) desc, count(*) desc
      limit ${limit}`),
  );
}
