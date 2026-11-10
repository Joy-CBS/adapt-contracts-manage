import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { StudioClient, parseStepText } from "@/lib/studio/client";
import { type ChecklistEntry, type RawReview, countItems, finalizeReview, verdictOf } from "@/lib/review-types";

/**
 * 담당자가 유형을 바꾼 계약서를 Studio 검토 Agent로 다시 검토한다.
 * 새 유형의 검토 Config(플레이북 기준)로 Job을 띄우고, 계약서 화면을 열 때 완료 여부를 확인해 결과를 반영한다.
 * Studio 키(UPSTAGE_API_KEY)가 없는 배포에서는 "재검토 대기"로만 표시한다.
 */

export function studioAvailable() {
  return Boolean(process.env.UPSTAGE_API_KEY);
}

async function resource(key: string) {
  const d = await db();
  const [r] = await d.select().from(schema.studioResources).where(eq(schema.studioResources.key, key));
  return r?.value || null;
}

export async function startReReview(contractId: string): Promise<{ ok: boolean; message: string }> {
  const d = await db();
  const [row] = await d
    .select({ c: schema.contracts, cat: schema.categories })
    .from(schema.contracts)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.contracts.categoryId))
    .where(eq(schema.contracts.id, contractId));
  if (!row?.cat || !row.c.studioFileId) return { ok: false, message: "계약서 파일 정보가 없어 재검토할 수 없습니다." };
  if (!studioAvailable()) return { ok: false, message: "이 배포에는 Studio 키가 없어 재검토를 바로 실행할 수 없습니다. 재검토 대기로 표시합니다." };
  const agentId = await resource("v2.review.agent");
  const configId = await resource(`v2.review.config.${row.cat.classKey}`);
  if (!agentId || !configId) return { ok: false, message: "검토 Agent 설정을 찾지 못했습니다." };
  const job = await new StudioClient().runAgent({
    agentId,
    configId,
    fileIds: [row.c.studioFileId],
    metadata: { contract_id: contractId, bucket: row.cat.classKey, purpose: "re-review" },
  });
  await d.update(schema.contracts).set({ reReviewJobId: job.id, updatedAt: new Date() }).where(eq(schema.contracts.id, contractId));
  return { ok: true, message: "새 유형 기준으로 재검토를 시작했습니다. 1~2분 뒤 결과가 반영됩니다." };
}

/** 진행 중인 재검토 Job이 끝났으면 검토 결과를 교체한다. 반환: 진행 상태 */
export async function syncReReview(contractId: string): Promise<"none" | "running" | "done" | "failed"> {
  const d = await db();
  const [row] = await d
    .select({ c: schema.contracts, cat: schema.categories })
    .from(schema.contracts)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.contracts.categoryId))
    .where(eq(schema.contracts.id, contractId));
  const jobId = row?.c.reReviewJobId;
  if (!row || !jobId || !row.c.needsReReview) return "none";
  if (!studioAvailable()) return "running";
  const res = await new StudioClient().getResponse(jobId, "all");
  if (["in_progress", "queued", "cancelling"].includes(res.status)) return "running";
  if (res.status !== "completed") {
    await d.update(schema.contracts).set({ reReviewJobId: null }).where(eq(schema.contracts.id, contractId));
    return "failed";
  }
  const ins = res.output?.find((o) => o.step_type === "instruct")?.content?.[0];
  const parsed = parseStepText<RawReview>(ins?.text?.replace(/【[^】]*†[^】]*】/g, "") ?? null);
  if (!parsed) return "failed";
  const checklist = JSON.parse((await resource(`v2.checklist.${row.cat!.classKey}`)) ?? "[]") as ChecklistEntry[];
  const result = finalizeReview(parsed, checklist);
  const items = result.items;
  const n = countItems(items);
  const [tpl] = await d.select({ id: schema.standardTemplates.id }).from(schema.standardTemplates).where(eq(schema.standardTemplates.categoryId, row.cat!.id));
  await d.delete(schema.reviews).where(eq(schema.reviews.contractId, contractId));
  await d.insert(schema.reviews).values({
    contractId,
    templateId: tpl?.id ?? null,
    verdict: verdictOf(items, result.is_high_value),
    highCount: n.riskHigh,
    mediumCount: n.riskMedium,
    lowCount: n.risk - n.riskHigh - n.riskMedium,
    riskCount: n.risk,
    lawyerCount: n.lawyer,
    noteCount: n.note,
    bucket: row.cat!.classKey,
    model: "solar-pro4",
    schemaVersion: 2,
    result,
    studioJobId: jobId,
  });
  await d
    .update(schema.contracts)
    .set({ needsReReview: false, reReviewJobId: null, status: "reviewed", updatedAt: new Date() })
    .where(eq(schema.contracts.id, contractId));
  return "done";
}
