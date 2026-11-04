import { getContract } from "@/lib/queries";
import { buildRedlineDocx } from "@/lib/redline";

export const runtime = "nodejs";

/** 검토 결과로 Word 변경기록(.docx)을 즉석에서 만들어 내려준다 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getContract(id);
  if (!data?.review?.result || !data.template) return new Response("검토 결과가 없습니다", { status: 404 });
  const { contract, category, review, template } = data;
  const buf = await buildRedlineDocx({
    template,
    categoryName: category?.name ?? template.title_ko,
    review: review.result!,
    verdict: review.verdict ?? undefined,
    contractFilename: contract.filename,
    contractLanguage: contract.language ?? undefined,
    placeholders: contract.metadata,
    reviewedAt: review.createdAt,
  });
  const name = `${contract.filename.replace(/\.[^.]+$/, "")}_검토.docx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="redline.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
