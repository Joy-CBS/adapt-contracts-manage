import { getContract } from "@/lib/queries";
import { buildRedlineV2 } from "@/lib/redline-v2";

export const runtime = "nodejs";

/** 검토 결과로 표준양식 변경기록(.docx) 또는 검토 의견서(.docx)를 즉석에서 만들어 내려준다 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getContract(id);
  if (!data?.review?.result) return new Response("검토 결과가 없습니다", { status: 404 });
  const { contract, category, review, standard, states } = data;
  const buf = await buildRedlineV2({
    standard,
    categoryName: category?.name ?? "",
    review: review.result,
    verdict: review.verdict,
    contractFilename: contract.filename,
    states: new Map([...states].map(([k, v]) => [k, { status: v.status, resolution: v.resolution, answerNote: v.answerNote }])),
    reviewedAt: review.createdAt,
  });
  const base = contract.filename.replace(/\.[^.]+$/, "");
  const name = `${base}_${standard ? "표준양식_변경기록" : "검토의견서"}.docx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="review.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
