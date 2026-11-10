import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { StudioClient } from "@/lib/studio/client";
import { RUNNING, readClassify, readExtract, readReview } from "@/lib/pipeline";
import { type ChecklistEntry, assessClassification, countItems, finalizeReview, reviewTargetFor, verdictOf } from "@/lib/review-types";

/**
 * 검토 요청 처리(배포 서버에서 실행). 단계:
 *   analyzing  : 업로드 직후 Studio 정보 추출(SP4)·유형 판단(SP4) Job 진행 중
 *   type_check : 유형 판단 완료 → 담당자가 유형 확정(맞음 / 다른 유형 / 신규 유형)
 *   reviewing  : 확정한 유형의 플레이북으로 Studio 리스크 검토(GPT) 진행 중
 *   reviewed   : 결과 확인 → 수정본 내려받기, 변호사 확인 요청·답변 기록
 *   done       : 담당자가 검토 완료 처리
 * Job 완료 여부는 화면을 열 때 확인한다(syncRequest). 별도 백그라운드 작업이 필요 없다.
 */

export type Stage = "analyzing" | "type_check" | "reviewing" | "reviewed" | "done" | "failed";

export function studioReady() {
  return Boolean(process.env.UPSTAGE_API_KEY);
}

async function resources() {
  const d = await db();
  const rows = await d.select().from(schema.studioResources);
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function categoryNames() {
  const d = await db();
  const rows = await d.select({ key: schema.categories.classKey, name: schema.categories.name }).from(schema.categories);
  return new Map(rows.map((r) => [r.key, r.name]));
}

export async function createRequest(input: { bytes: Buffer; filename: string; note?: string }): Promise<{ id: string; existed?: boolean }> {
  const d = await db();
  const sha256 = crypto.createHash("sha256").update(input.bytes).digest("hex");
  const [dup] = await d.select({ id: schema.contracts.id }).from(schema.contracts).where(eq(schema.contracts.sha256, sha256));
  if (dup) return { id: dup.id, existed: true };
  const res = await resources();
  const studio = new StudioClient();
  const file = await studio.uploadFile(new Blob([new Uint8Array(input.bytes)]), input.filename);
  const meta = { purpose: "review-request", sha256 };
  const [ex, cl] = await Promise.all([
    studio.runAgent({ agentId: res.get("v3.extract.agent")!, configId: res.get("v3.extract.config"), fileIds: [file.id], metadata: meta }),
    studio.runAgent({ agentId: res.get("v3.classify.agent")!, configId: res.get("v3.classify.config"), fileIds: [file.id], metadata: meta }),
  ]);
  const [row] = await d
    .insert(schema.contracts)
    .values({
      source: "upload",
      filename: input.filename,
      sha256,
      studioFileId: file.id,
      extractJobId: ex.id,
      studioClassifyJobId: cl.id,
      status: "processing",
      stage: "analyzing",
      requestNote: input.note?.trim() || null,
      requestedAt: new Date(),
    })
    .returning({ id: schema.contracts.id });
  return { id: row.id };
}

/** 진행 중인 Studio Job을 확인해 단계를 넘긴다 */
export async function syncRequest(id: string): Promise<Stage | null> {
  const d = await db();
  const [c] = await d.select().from(schema.contracts).where(eq(schema.contracts.id, id));
  if (!c?.stage) return null;
  if (!studioReady() || !["analyzing", "reviewing"].includes(c.stage)) return c.stage as Stage;
  const studio = new StudioClient();

  if (c.stage === "analyzing" && c.extractJobId && c.studioClassifyJobId) {
    const [ex, cl] = await Promise.all([studio.getResponse(c.extractJobId, "all"), studio.getResponse(c.studioClassifyJobId, "all")]);
    if (RUNNING.includes(ex.status) || RUNNING.includes(cl.status)) return "analyzing";
    if (ex.status !== "completed" || cl.status !== "completed") {
      await d
        .update(schema.contracts)
        .set({ stage: "failed", status: "failed", error: ex.error?.message ?? cl.error?.message ?? "Studio 분석 실패", updatedAt: new Date() })
        .where(eq(schema.contracts.id, id));
      return "failed";
    }
    const metadata = readExtract(ex.output as never) ?? {};
    const r = readClassify(cl.output as never);
    const names = await categoryNames();
    const classification = assessClassification({ model: "solar-pro4", label: r.label, rationale: r.rationale, nameOf: (k) => names.get(k) ?? k });
    const [cat] = await d.select().from(schema.categories).where(eq(schema.categories.classKey, classification.suggested));
    await d
      .update(schema.contracts)
      .set({
        stage: "type_check",
        status: "analyzed",
        metadata,
        language: String(metadata.language ?? ""),
        classification,
        categoryId: cat?.id ?? null,
        subtypeId: classification.suggested,
        classifyState: "suggested",
        updatedAt: new Date(),
      })
      .where(eq(schema.contracts.id, id));
    return "type_check";
  }

  if (c.stage === "reviewing" && c.reviewJobId) {
    const res = await studio.getResponse(c.reviewJobId, "all");
    if (RUNNING.includes(res.status)) return "reviewing";
    const x = res.status === "completed" ? readReview(res.output as never) : null;
    const [cat] = c.categoryId ? await d.select().from(schema.categories).where(eq(schema.categories.id, c.categoryId)) : [];
    if (!x?.raw || !cat) {
      await d
        .update(schema.contracts)
        .set({ stage: "failed", error: res.error?.message ?? "리스크 검토 결과를 읽지 못했습니다", updatedAt: new Date() })
        .where(eq(schema.contracts.id, id));
      return "failed";
    }
    const target = reviewTargetFor(cat.classKey, cat.hasStandard);
    const res2 = await resources();
    const checklist = JSON.parse(res2.get(`v3.checklist.${target}`) ?? "[]") as ChecklistEntry[];
    const result = finalizeReview(x.raw, checklist);
    const n = countItems(result.items);
    const [tpl] = await d.select({ id: schema.standardTemplates.id }).from(schema.standardTemplates).where(eq(schema.standardTemplates.categoryId, cat.id));
    await d.delete(schema.reviews).where(eq(schema.reviews.contractId, id));
    await d.insert(schema.reviews).values({
      contractId: id,
      templateId: tpl?.id ?? null,
      verdict: verdictOf(result.items, result.is_high_value),
      highCount: n.riskHigh,
      mediumCount: n.riskMedium,
      lowCount: n.risk - n.riskHigh - n.riskMedium,
      riskCount: n.risk,
      lawyerCount: n.lawyer,
      noteCount: n.note,
      bucket: target,
      model: "gpt (Studio 기본)",
      schemaVersion: 2,
      result,
      checks: x.checks,
      studioJobId: c.reviewJobId,
    });
    await d.update(schema.contracts).set({ stage: "reviewed", status: "reviewed", updatedAt: new Date() }).where(eq(schema.contracts.id, id));
    return "reviewed";
  }
  return c.stage as Stage;
}

/** 유형 확정 → 리스크 검토 시작 */
export async function confirmTypeAndReview(id: string, classKey: string, changed: boolean) {
  const d = await db();
  const [cat] = await d.select().from(schema.categories).where(eq(schema.categories.classKey, classKey));
  if (!cat) throw new Error("없는 유형입니다.");
  const [c] = await d.select().from(schema.contracts).where(eq(schema.contracts.id, id));
  if (!c?.studioFileId) throw new Error("계약서 파일 정보가 없습니다.");
  const res = await resources();
  const target = reviewTargetFor(cat.classKey, cat.hasStandard);
  const job = await new StudioClient().runAgent({
    agentId: res.get("v3.review.agent")!,
    configId: res.get(`v3.review.config.${target}`),
    fileIds: [c.studioFileId],
    metadata: { contract_id: id, target, purpose: "review-request" },
  });
  await d
    .update(schema.contracts)
    .set({
      categoryId: cat.id,
      classifyState: changed ? "changed" : "approved",
      classifyDecidedAt: new Date(),
      stage: "reviewing",
      status: "processing",
      reviewJobId: job.id,
      needsReReview: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.contracts.id, id));
}

/** 담당자가 등록하는 신규 유형(어댑트 표준 없음 → 공통 기준으로 검토, 표준 제정 대상) */
export async function createNewCategory(name: string, definition: string) {
  const d = await db();
  const classKey = `new_${Date.now().toString(36)}`;
  await d.insert(schema.categories).values({
    classKey,
    name: name.trim(),
    definition: definition.trim() || "검토 요청에서 담당자가 등록한 신규 유형",
    includeSignals: [],
    excludeSignals: [],
    hasStandard: false,
    standardizable: true,
    standardizableReason: "표준 제정 필요",
    origin: "new",
    status: "draft",
    taxonomyStatus: "new",
    group: "신규 유형",
    sortOrder: 900,
  });
  return classKey;
}
