import { eq, inArray, sql } from "drizzle-orm";
import { type DB, schema } from "@/db";
import type { Extracted } from "@/lib/contracts";
import { type ChecklistEntry, type Classification, type ReviewV2, type StandardDocV2, countItems } from "@/lib/review-types";

/**
 * 분석 결과 묶음(SeedBundle v2)을 DB에 적재한다.
 * - 로컬 스크립트(npm run db:seed)와 배포 사이트의 관리 화면(/admin) 업로드가 같은 함수를 쓴다.
 * - 기존 계약서(source=legacy)와 그 검토 결과는 묶음 기준으로 교체한다. Slack 등 다른 경로로 들어온 계약서는 건드리지 않는다.
 * - 담당자가 이미 승인·변경한 분류와 변호사 확인 기록은 sha256 기준으로 보존한다(같은 항목 번호에 다시 붙인다).
 */

export type SeedCategory = {
  key: string;
  name: string;
  definition: string;
  includeSignals: string[];
  excludeSignals: string[];
  standardId: string | null;
  hasStandard: boolean;
  estimate: number | null;
  sortOrder: number;
};

export type SeedSubtype = {
  id: string;
  nameKo: string;
  group: string;
  standardId: string | null;
  status: string;
  definition: string;
  includeSignals: string[];
  excludeSignals: string[];
  bucket: string;
};

export type SeedBundle = {
  version: 2;
  generated_at: string;
  model: string;
  categories: SeedCategory[];
  subtypes: SeedSubtype[];
  standards: StandardDocV2[];
  /** 유형별 검토 체크리스트(재검토 결과를 결론으로 바꿀 때 사용) */
  checklists: Record<string, ChecklistEntry[]>;
  /** 담당자가 유형을 바꿨을 때 재검토에 쓸 Studio Agent·Config ID */
  studio: Record<string, string>;
  contracts: Array<{
    sha256: string;
    path: string;
    folder: string;
    filename: string;
    fileId?: string;
    jobId?: string;
    classifyJobId?: string;
    bucket: string;
    subtypeId?: string | null;
    classification: Classification;
    metadata: Extracted;
    review?: { jobId: string; bucket: string; model: string; verdict?: string; result: ReviewV2; checks?: unknown };
  }>;
};

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function seedBundle(d: DB, b: SeedBundle) {
  if (b.version !== 2) throw new Error("이전 형식의 묶음입니다. 새로 생성한 seed-bundle.json.gz를 올려 주세요.");

  // 0) 보존할 담당자 기록(분류 결정, 변호사 확인)
  const kept = await d
    .select({
      sha256: schema.contracts.sha256,
      classifyState: schema.contracts.classifyState,
      classifyDecidedAt: schema.contracts.classifyDecidedAt,
      classifyNote: schema.contracts.classifyNote,
      categoryKey: schema.categories.classKey,
    })
    .from(schema.contracts)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.contracts.categoryId))
    .where(eq(schema.contracts.source, "legacy"));
  const keptBySha = new Map(kept.filter((k) => k.sha256 && k.classifyState !== "suggested").map((k) => [k.sha256!, k]));
  const keptStates = await d.execute(sql`
    select c.sha256, s.item_index, s.status, s.request_note, s.resolution, s.answer_note, s.requested_at, s.answered_at
    from review_item_states s join reviews r on r.id = s.review_id join contracts c on c.id = r.contract_id
    where c.source = 'legacy'`);
  const stateRows = ((keptStates as { rows?: unknown[] }).rows ?? (keptStates as unknown[])) as Array<{
    sha256: string;
    item_index: number;
    status: "open" | "requested" | "answered";
    request_note: string | null;
    resolution: string | null;
    answer_note: string | null;
    requested_at: string | null;
    answered_at: string | null;
  }>;

  // 1) 검토 범위(카테고리): class_key 기준 upsert, 묶음에 없는 옛 카테고리는 계약서 연결을 끊고 삭제
  const catId = new Map<string, string>();
  for (const c of b.categories) {
    const values = {
      classKey: c.key,
      name: c.name,
      definition: c.definition,
      includeCriteria: c.includeSignals.join("\n"),
      excludeCriteria: c.excludeSignals.join("\n"),
      includeSignals: c.includeSignals,
      excludeSignals: c.excludeSignals,
      standardId: c.standardId,
      hasStandard: c.hasStandard,
      estimate: c.estimate,
      sortOrder: c.sortOrder,
      standardizable: true,
      standardizableReason: c.hasStandard ? `어댑트 표준 ${c.standardId}` : "어댑트 표준 없음",
      origin: c.hasStandard ? ("adapt_standard" as const) : ("derived" as const),
      status: c.hasStandard ? ("confirmed" as const) : ("draft" as const),
    };
    const [row] = await d
      .insert(schema.categories)
      .values(values)
      .onConflictDoUpdate({ target: schema.categories.classKey, set: values })
      .returning({ id: schema.categories.id });
    catId.set(c.key, row.id);
  }

  // 2) 기존 legacy 계약서·검토 삭제 후 다시 넣는다(검토 항목 상태는 cascade 삭제 → 아래에서 복원)
  const legacy = await d.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.source, "legacy"));
  for (const ids of chunk(legacy.map((r) => r.id), 200)) await d.delete(schema.reviews).where(inArray(schema.reviews.contractId, ids));
  await d.delete(schema.contracts).where(eq(schema.contracts.source, "legacy"));

  // 3) 옛 카테고리·표준안 정리
  const keep = [...catId.values()];
  await d.delete(schema.reviews).where(
    inArray(schema.reviews.templateId, d.select({ id: schema.standardTemplates.id }).from(schema.standardTemplates)),
  );
  await d.delete(schema.standardTemplates);
  const stale = (await d.select({ id: schema.categories.id }).from(schema.categories)).filter((r) => !keep.includes(r.id)).map((r) => r.id);
  if (stale.length) {
    await d.update(schema.contracts).set({ categoryId: null }).where(inArray(schema.contracts.categoryId, stale));
    await d.delete(schema.categories).where(inArray(schema.categories.id, stale));
  }

  // 4) 세부 유형(어댑트 분류체계 49종)
  await d.delete(schema.subtypes);
  for (const part of chunk(b.subtypes, 50)) await d.insert(schema.subtypes).values(part);

  // 5) 표준계약서(어댑트 원본 docx)
  const tplId = new Map<string, string>();
  for (const t of b.standards) {
    const cid = catId.get(t.bucket);
    if (!cid) continue;
    const [row] = await d
      .insert(schema.standardTemplates)
      .values({ categoryId: cid, title: t.title, source: "adapt_original", version: 2, body: t })
      .returning({ id: schema.standardTemplates.id });
    tplId.set(t.bucket, row.id);
  }

  // 6) Studio 리소스(재검토용 Config)
  for (const [key, value] of Object.entries(b.studio)) {
    await d
      .insert(schema.studioResources)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.studioResources.key, set: { value, updatedAt: new Date() } });
  }

  for (const [bucket, list] of Object.entries(b.checklists ?? {})) {
    const key = `v2.checklist.${bucket}`;
    const value = JSON.stringify(list);
    await d
      .insert(schema.studioResources)
      .values({ key, value, note: "검토 체크리스트" })
      .onConflictDoUpdate({ target: schema.studioResources.key, set: { value, updatedAt: new Date() } });
  }

  // 7) 계약서
  const contractId = new Map<string, string>();
  for (const part of chunk(b.contracts, 50)) {
    const rows = await d
      .insert(schema.contracts)
      .values(
        part.map((c) => {
          const k = keptBySha.get(c.sha256);
          const bucket = k?.categoryKey && catId.has(k.categoryKey) ? k.categoryKey : c.bucket;
          return {
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
            categoryId: catId.get(bucket),
            classifyConfidence: c.classification.confidence,
            classification: c.classification,
            classifyState: k?.classifyState ?? ("suggested" as const),
            classifyDecidedAt: k?.classifyDecidedAt ?? null,
            classifyNote: k?.classifyNote ?? null,
            subtypeId: c.subtypeId ?? null,
            needsReReview: Boolean(c.review && c.review.bucket !== bucket),
            metadata: c.metadata,
          };
        }),
      )
      .onConflictDoNothing({ target: schema.contracts.sha256 })
      .returning({ id: schema.contracts.id, sha256: schema.contracts.sha256 });
    for (const r of rows) if (r.sha256) contractId.set(r.sha256, r.id);
  }

  // 8) 검토 결과
  const reviewRows = b.contracts
    .filter((c) => c.review && contractId.has(c.sha256))
    .map((c) => {
      const r = c.review!;
      const n = countItems(r.result.items);
      return {
        contractId: contractId.get(c.sha256)!,
        templateId: tplId.get(r.bucket),
        verdict: r.verdict,
        highCount: n.riskHigh,
        mediumCount: n.riskMedium,
        lowCount: n.risk - n.riskHigh - n.riskMedium,
        riskCount: n.risk,
        lawyerCount: n.lawyer,
        noteCount: n.note,
        bucket: r.bucket,
        model: r.model,
        schemaVersion: 2,
        result: r.result,
        checks: r.checks ?? null,
        studioJobId: r.jobId,
      };
    });
  const reviewId = new Map<string, string>();
  for (const part of chunk(reviewRows, 25)) {
    const rows = await d.insert(schema.reviews).values(part).returning({ id: schema.reviews.id, contractId: schema.reviews.contractId });
    for (const r of rows) reviewId.set(r.contractId, r.id);
  }

  // 9) 변호사 확인 기록 복원
  const restore = stateRows
    .map((s) => {
      const cid = contractId.get(s.sha256);
      const rid = cid ? reviewId.get(cid) : undefined;
      if (!rid) return null;
      return {
        reviewId: rid,
        itemIndex: s.item_index,
        status: s.status,
        requestNote: s.request_note,
        resolution: s.resolution,
        answerNote: s.answer_note,
        requestedAt: s.requested_at ? new Date(s.requested_at) : null,
        answeredAt: s.answered_at ? new Date(s.answered_at) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  for (const part of chunk(restore, 50)) await d.insert(schema.reviewItemStates).values(part).onConflictDoNothing();

  return {
    categories: catId.size,
    standards: tplId.size,
    contracts: contractId.size,
    reviews: reviewRows.length,
    keptDecisions: keptBySha.size,
    keptLawyerItems: restore.length,
  };
}
