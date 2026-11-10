import { createRequest, studioReady } from "@/lib/requests";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 검토 요청 접수: 파일을 Studio에 올리고 정보 추출·유형 판단 Job을 시작한다 */
export async function POST(req: Request) {
  if (!studioReady()) return Response.json({ error: "Studio 키(UPSTAGE_API_KEY)가 설정되지 않았습니다." }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "계약서 파일을 선택해 주세요." }, { status: 400 });
  if (!/\.(pdf|docx?|hwpx?|png|jpe?g)$/i.test(file.name)) return Response.json({ error: "PDF, Word, 한글, 이미지 파일만 올릴 수 있습니다." }, { status: 400 });
  try {
    const r = await createRequest({ bytes: Buffer.from(await file.arrayBuffer()), filename: file.name, note: String(form?.get("note") ?? "") });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: `접수하지 못했습니다: ${String(e).slice(0, 200)}` }, { status: 500 });
  }
}
