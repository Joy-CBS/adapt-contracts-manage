import { getStandard } from "@/lib/queries";

export const runtime = "nodejs";

/** 어댑트 표준계약서 원본(.docx) 내려받기 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await getStandard(key);
  if (!s?.standard) return new Response("표준계약서가 없습니다", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(s.standard.docxBase64, "base64")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="standard.docx"; filename*=UTF-8''${encodeURIComponent(s.standard.sourceFile)}`,
    },
  });
}
