"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { OTHERS_KEY } from "@/lib/buckets";
import { startReReview } from "@/lib/rereview";

/**
 * 검토 담당자 조치(서버 액션). 로그인한 사용자만 화면에 접근하므로 별도 권한 구분은 두지 않는다(데모 단일 계정).
 */

export type ActionResult = { ok: boolean; message: string };

function refresh(contractId?: string) {
  revalidatePath("/");
  revalidatePath("/classify");
  revalidatePath("/lawyer");
  revalidatePath("/contracts");
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

/** 분류 승인(여러 건 가능) */
export async function approveClassification(ids: string[]): Promise<ActionResult> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (!valid.length) return { ok: false, message: "선택한 계약서가 없습니다." };
  const d = await db();
  await d
    .update(schema.contracts)
    .set({ classifyState: "approved", classifyDecidedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(schema.contracts.id, valid), eq(schema.contracts.classifyState, "suggested")));
  refresh(valid.length === 1 ? valid[0] : undefined);
  return { ok: true, message: `${valid.length}건을 승인했습니다.` };
}

/** 근거 충분 등급 일괄 승인 */
export async function approveAllStrong(): Promise<ActionResult> {
  const d = await db();
  const rows = await d
    .update(schema.contracts)
    .set({ classifyState: "approved", classifyDecidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.contracts.classifyState, "suggested"), sql`${schema.contracts.classification}->>'level' = 'strong'`))
    .returning({ id: schema.contracts.id });
  refresh();
  return { ok: true, message: `근거 충분 ${rows.length}건을 승인했습니다.` };
}

/** 다른 유형(또는 기타)으로 분류. 검토 기준이 바뀌므로 재검토를 건다 */
export async function changeClassification(contractId: string, classKey: string, note?: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/.test(contractId)) return { ok: false, message: "잘못된 요청입니다." };
  const d = await db();
  const [cat] = await d.select().from(schema.categories).where(eq(schema.categories.classKey, classKey));
  if (!cat) return { ok: false, message: "없는 유형입니다." };
  const [c] = await d.select().from(schema.contracts).where(eq(schema.contracts.id, contractId));
  if (!c) return { ok: false, message: "계약서를 찾지 못했습니다." };
  const [rv] = await d.select({ bucket: schema.reviews.bucket }).from(schema.reviews).where(eq(schema.reviews.contractId, contractId));
  const sameAsReview = rv?.bucket === classKey;
  await d
    .update(schema.contracts)
    .set({
      categoryId: cat.id,
      classifyState: "changed",
      classifyDecidedAt: new Date(),
      classifyNote: note?.trim() || null,
      needsReReview: !sameAsReview,
      reReviewJobId: sameAsReview ? null : c.reReviewJobId,
      updatedAt: new Date(),
    })
    .where(eq(schema.contracts.id, contractId));
  let message = `${cat.name}${classKey === OTHERS_KEY ? "(공통 기준 검토)" : ""}(으)로 분류했습니다.`;
  if (!sameAsReview) {
    const r = await startReReview(contractId).catch((e) => ({ ok: false, message: `재검토 시작 실패: ${String(e).slice(0, 120)}` }));
    message += ` ${r.message}`;
  }
  refresh(contractId);
  return { ok: true, message };
}

/** 분류 결정을 되돌린다(승인 대기로) */
export async function resetClassification(contractId: string): Promise<ActionResult> {
  const d = await db();
  await d
    .update(schema.contracts)
    .set({ classifyState: "suggested", classifyDecidedAt: null, updatedAt: new Date() })
    .where(eq(schema.contracts.id, contractId));
  refresh(contractId);
  return { ok: true, message: "승인 대기로 되돌렸습니다." };
}

export async function retryReReview(contractId: string): Promise<ActionResult> {
  const r = await startReReview(contractId).catch((e) => ({ ok: false, message: String(e).slice(0, 160) }));
  refresh(contractId);
  return r;
}

async function upsertState(reviewId: string, itemIndex: number, values: Partial<typeof schema.reviewItemStates.$inferInsert>) {
  const d = await db();
  await d
    .insert(schema.reviewItemStates)
    .values({ reviewId, itemIndex, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.reviewItemStates.reviewId, schema.reviewItemStates.itemIndex], set: { ...values, updatedAt: new Date() } });
}

async function contractOfReview(reviewId: string) {
  const d = await db();
  const [r] = await d.select({ contractId: schema.reviews.contractId }).from(schema.reviews).where(eq(schema.reviews.id, reviewId));
  return r?.contractId;
}

/** 변호사 확인 요청(여러 항목) */
export async function requestLawyer(reviewId: string, itemIndexes: number[], note?: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/.test(reviewId) || !itemIndexes.length) return { ok: false, message: "잘못된 요청입니다." };
  for (const i of itemIndexes) await upsertState(reviewId, i, { status: "requested", requestNote: note?.trim() || null, requestedAt: new Date() });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: `${itemIndexes.length}개 항목을 변호사 확인 요청으로 표시했습니다.` };
}

/** 변호사 답변 기록 */
export async function answerLawyer(reviewId: string, itemIndex: number, resolution: string, note?: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/.test(reviewId)) return { ok: false, message: "잘못된 요청입니다." };
  await upsertState(reviewId, itemIndex, { status: "answered", resolution, answerNote: note?.trim() || null, answeredAt: new Date() });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: "변호사 답변을 기록했습니다." };
}

export async function reopenLawyer(reviewId: string, itemIndex: number): Promise<ActionResult> {
  await upsertState(reviewId, itemIndex, { status: "open", resolution: null, answerNote: null, requestedAt: null, answeredAt: null });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: "요청 전 상태로 되돌렸습니다." };
}
