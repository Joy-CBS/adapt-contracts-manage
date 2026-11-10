import { eq, inArray, or } from "drizzle-orm";
import { type DB, schema } from "@/db";
import type { Extracted } from "@/lib/contracts";
import { type ChecklistEntry, type Classification, type ReviewV2, type StandardDocV2, countItems } from "@/lib/review-types";

/**
 * 분석 결과 묶음(SeedBundle v3)을 DB에 적재한다. 로컬 스크립트와 배포 사이트 /admin 업로드가 같은 함수를 쓴다.
 * - 유형: 어댑트 분류체계 전체(49종). 담당자가 새로 등록한 유형(origin=new)은 지우지 않는다.
 * - 계약서 보관함(source=legacy): 묶음 기준으로 교체. 담당자가 확인·변경한 분류는 sha256 기준으로 보존.
 * - 검토 요청 샘플(source=upload, 묶음에 든 것만): 교체. 사용자가 직접 올린 요청은 건드리지 않는다.
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
  group: string;
  taxonomyStatus: string;
  sortOrder: number;
};

export type SeedReview = { jobId: string; target: string; model: string; verdict: string; result: ReviewV2; checks?: unknown };

export type SeedContract = {
  source: "legacy" | "upload";
  sha256: string;
  path: string;
  folder: string;
  filename: string;
  fileId?: string;
  extractJobId?: string;
  classifyJobId?: string;
  type: string;
  classification: Classification;
  classifyState: "suggested" | "approved" | "changed";
  metadata: Extracted;
  review?: SeedReview;
  /** 검토 요청 샘플만 */
  stage?: string;
  requestedAt?: string;
  completedAt?: string;
  requestNote?: string;
  itemStates?: Array<{ itemIndex: number; status: "open" | "requested" | "answered"; resolution?: string; answerNote?: string }>;
};

export type SeedBundle = {
  version: 3;
  generated_at: string;
  categories: SeedCategory[];
  standards: StandardDocV2[];
  checklists: Record<string, ChecklistEntry[]>;
  studio: Record<string, string>;
  contracts: SeedContract[];
};

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function seedBundle(d: DB, b: SeedBundle) {
  if (b.version !== 3) throw new Error("이전 형식의 묶음입니다. 새로 생성한 seed-bundle을 올려 주세요.");

  // 0) 보존할 담당자 기록(보관함 분류 결정)
  const kept = await d
    .select({ sha256: schema.contracts.sha256, classifyState: schema.contracts.classifyState, key: schema.categories.classKey })
    .from(schema.contracts)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.contracts.categoryId))
    .where(eq(schema.contracts.source, "legacy"));
  const keptBySha = new Map(kept.filter((k) => k.sha256 && k.classifyState !== "suggested").map((k) => [k.sha256!, k]));

  // 1) 유형
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
      group: c.group,
      taxonomyStatus: c.taxonomyStatus,
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

  // 2) 보관함·샘플 요청 삭제(검토·항목 상태는 cascade)
  const sampleShas = b.contracts.filter((c) => c.source === "upload").map((c) => c.sha256);
  const old = await d
    .select({ id: schema.contracts.id })
    .from(schema.contracts)
    .where(or(eq(schema.contracts.source, "legacy"), inArray(schema.contracts.sha256, sampleShas.length ? sampleShas : ["-"])));
  for (const ids of chunk(
    old.map((r) => r.id),
    200,
  )) {
    await d.delete(schema.reviews).where(inArray(schema.reviews.contractId, ids));
    await d.delete(schema.contracts).where(inArray(schema.contracts.id, ids));
  }

  // 3) 표준계약서 교체, 옛 유형 정리(담당자가 만든 신규 유형은 유지)
  await d.update(schema.reviews).set({ templateId: null });
  await d.delete(schema.standardTemplates);
  const keep = new Set(catId.values());
  const stale = (await d.select({ id: schema.categories.id, origin: schema.categories.origin }).from(schema.categories)).filter(
    (r) => !keep.has(r.id) && r.origin !== "new",
  );
  if (stale.length) {
    const ids = stale.map((r) => r.id);
    await d.update(schema.contracts).set({ categoryId: null }).where(inArray(schema.contracts.categoryId, ids));
    await d.delete(schema.categories).where(inArray(schema.categories.id, ids));
  }
  await d.delete(schema.subtypes);

  const tplId = new Map<string, string>();
  for (const t of b.standards) {
    const cid = catId.get(t.bucket);
    if (!cid) continue;
    const [row] = await d
      .insert(schema.standardTemplates)
      .values({ categoryId: cid, title: t.title, source: "adapt_original", version: 3, body: t })
      .returning({ id: schema.standardTemplates.id });
    tplId.set(t.bucket, row.id);
  }

  // 4) Studio 리소스·검토 체크리스트
  const resources = { ...b.studio, ...Object.fromEntries(Object.entries(b.checklists).map(([k, v]) => [`v3.checklist.${k}`, JSON.stringify(v)])) };
  for (const [key, value] of Object.entries(resources)) {
    await d
      .insert(schema.studioResources)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.studioResources.key, set: { value, updatedAt: new Date() } });
  }

  // 5) 계약서
  const contractId = new Map<string, string>();
  for (const part of chunk(b.contracts, 50)) {
    const rows = await d
      .insert(schema.contracts)
      .values(
        part.map((c) => {
          const k = c.source === "legacy" ? keptBySha.get(c.sha256) : undefined;
          const type = k?.key && catId.has(k.key) ? k.key : c.type;
          return {
            source: c.source,
            filename: c.filename,
            sourcePath: c.path,
            sourceFolder: c.folder,
            sha256: c.sha256,
            studioFileId: c.fileId,
            studioJobId: c.extractJobId,
            extractJobId: c.extractJobId,
            studioClassifyJobId: c.classifyJobId,
            reviewJobId: c.review?.jobId,
            status: c.review ? ("reviewed" as const) : ("analyzed" as const),
            language: String(c.metadata.language ?? ""),
            categoryId: catId.get(type),
            subtypeId: type,
            classification: c.classification,
            classifyState: k?.classifyState ?? c.classifyState,
            classifyDecidedAt: c.classifyState !== "suggested" ? new Date() : null,
            metadata: c.metadata,
            stage: c.stage ?? null,
            requestedAt: c.requestedAt ? new Date(c.requestedAt) : null,
            completedAt: c.completedAt ? new Date(c.completedAt) : null,
            requestNote: c.requestNote ?? null,
          };
        }),
      )
      .onConflictDoNothing({ target: schema.contracts.sha256 })
      .returning({ id: schema.contracts.id, sha256: schema.contracts.sha256 });
    for (const r of rows) if (r.sha256) contractId.set(r.sha256, r.id);
  }

  // 6) 검토 결과
  const reviewRows = b.contracts
    .filter((c) => c.review && contractId.has(c.sha256))
    .map((c) => {
      const r = c.review!;
      const n = countItems(r.result.items);
      return {
        contractId: contractId.get(c.sha256)!,
        templateId: tplId.get(c.type) ?? null,
        verdict: r.verdict,
        highCount: n.riskHigh,
        mediumCount: n.riskMedium,
        lowCount: n.risk - n.riskHigh - n.riskMedium,
        riskCount: n.risk,
        lawyerCount: n.lawyer,
        noteCount: n.note,
        bucket: r.target,
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

  // 7) 샘플 요청의 변호사 확인 진행 상태
  const states = b.contracts.flatMap((c) => {
    const rid = reviewId.get(contractId.get(c.sha256) ?? "");
    if (!rid || !c.itemStates) return [];
    return c.itemStates.map((s) => ({
      reviewId: rid,
      itemIndex: s.itemIndex,
      status: s.status,
      resolution: s.resolution ?? null,
      answerNote: s.answerNote ?? null,
      requestedAt: s.status !== "open" ? new Date() : null,
      answeredAt: s.status === "answered" ? new Date() : null,
    }));
  });
  for (const part of chunk(states, 50)) await d.insert(schema.reviewItemStates).values(part).onConflictDoNothing();

  return {
    categories: catId.size,
    standards: tplId.size,
    contracts: contractId.size,
    reviews: reviewRows.length,
    keptDecisions: keptBySha.size,
  };
}
