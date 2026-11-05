import zlib from "node:zlib";
import { db, migrateDb } from "@/db";
import { type SeedBundle, seedBundle } from "@/lib/seed";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 분석 결과 묶음(seed-bundle.json.gz) 업로드 → 테이블 생성 + 적재.
 * 데모 비밀번호(Basic Auth, middleware)로 보호되는 환경에서만 허용한다.
 */
export async function POST(req: Request) {
  if (!process.env.DEMO_PASSWORD) {
    return Response.json({ error: "DEMO_PASSWORD를 설정한 환경에서만 사용할 수 있습니다." }, { status: 403 });
  }
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    const json = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    const bundle = JSON.parse(json) as SeedBundle;
    await migrateDb();
    const result = await seedBundle(await db(), bundle);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 500) }, { status: 400 });
  }
}
