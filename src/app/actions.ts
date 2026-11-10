"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { confirmTypeAndReview, createNewCategory, studioReady } from "@/lib/requests";

/** 검토 담당자 조치(서버 액션). 데모 단일 계정이라 권한 구분은 두지 않는다. */

export type ActionResult = { ok: boolean; message: string };

const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

function refresh(contractId?: string) {
  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath("/standards");
  if (contractId) {
    revalidatePath(`/requests/${contractId}`);
    revalidatePath(`/archive/${contractId}`);
  }
}

const noStudio: ActionResult = { ok: false, message: "Studio 키(UPSTAGE_API_KEY)가 설정되지 않아 리스크 검토를 시작할 수 없습니다." };

/** 유형 확정 → 그 유형의 플레이북으로 리스크 검토 시작 */
export async function confirmType(contractId: string, classKey: string, changed: boolean): Promise<ActionResult> {
  if (!isId(contractId)) return { ok: false, message: "잘못된 요청입니다." };
  if (!studioReady()) return noStudio;
  try {
    await confirmTypeAndReview(contractId, classKey, changed);
  } catch (e) {
    return { ok: false, message: `검토를 시작하지 못했습니다: ${String(e).slice(0, 140)}` };
  }
  refresh(contractId);
  return { ok: true, message: "리스크 검토를 시작했습니다." };
}

/** 기존에 없는 유형: 새 유형을 등록하고 공통 기준으로 검토 */
export async function registerNewType(contractId: string, name: string, definition: string): Promise<ActionResult> {
  if (!isId(contractId) || !name.trim()) return { ok: false, message: "유형 이름을 입력해 주세요." };
  if (!studioReady()) return noStudio;
  const key = await createNewCategory(name, definition);
  return confirmType(contractId, key, true);
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
  if (!isId(reviewId) || !itemIndexes.length) return { ok: false, message: "잘못된 요청입니다." };
  for (const i of itemIndexes) await upsertState(reviewId, i, { status: "requested", requestNote: note?.trim() || null, requestedAt: new Date() });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: `${itemIndexes.length}개 항목을 변호사에게 요청한 것으로 표시했습니다.` };
}

/** 변호사 답변 기록 */
export async function answerLawyer(reviewId: string, itemIndex: number, resolution: string, note?: string): Promise<ActionResult> {
  if (!isId(reviewId)) return { ok: false, message: "잘못된 요청입니다." };
  await upsertState(reviewId, itemIndex, { status: "answered", resolution, answerNote: note?.trim() || null, answeredAt: new Date() });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: "답변을 기록했습니다." };
}

export async function reopenLawyer(reviewId: string, itemIndex: number): Promise<ActionResult> {
  await upsertState(reviewId, itemIndex, { status: "open", resolution: null, answerNote: null, requestedAt: null, answeredAt: null });
  refresh(await contractOfReview(reviewId));
  return { ok: true, message: "요청 전으로 되돌렸습니다." };
}

/** 검토 완료 처리 */
export async function completeRequest(contractId: string): Promise<ActionResult> {
  if (!isId(contractId)) return { ok: false, message: "잘못된 요청입니다." };
  const d = await db();
  await d.update(schema.contracts).set({ stage: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(schema.contracts.id, contractId));
  refresh(contractId);
  return { ok: true, message: "검토를 완료했습니다." };
}

export async function reopenRequest(contractId: string): Promise<ActionResult> {
  const d = await db();
  await d.update(schema.contracts).set({ stage: "reviewed", completedAt: null, updatedAt: new Date() }).where(eq(schema.contracts.id, contractId));
  refresh(contractId);
  return { ok: true, message: "다시 진행 중으로 돌렸습니다." };
}

/** 보관함: 분류가 맞다고 확인 */
export async function approveArchiveType(contractId: string): Promise<ActionResult> {
  const d = await db();
  await d.update(schema.contracts).set({ classifyState: "approved", classifyDecidedAt: new Date() }).where(eq(schema.contracts.id, contractId));
  refresh(contractId);
  return { ok: true, message: "분류를 확인했습니다." };
}
