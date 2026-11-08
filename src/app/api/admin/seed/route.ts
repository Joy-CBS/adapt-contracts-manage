import zlib from "node:zlib";
import { db, dbMode, describeDbError, migrateDb } from "@/db";
import { type SeedBundle, seedBundle } from "@/lib/seed";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** 연결된 DB 상태 확인(접속 문자열 자체는 노출하지 않음) */
export async function GET() {
  const m = dbMode();
  let reachable: boolean | null = null;
  let error: string | undefined;
  if (m.mode !== "missing") {
    try {
      const d = await db();
      await d.execute("select 1");
      reachable = true;
    } catch (e) {
      reachable = false;
      error = describeDbError(e);
    }
  }
  return Response.json({ ...m, reachable, error });
}

/**
 * 분석 결과 묶음(seed-bundle.json.gz) 업로드 → 테이블 생성 + 적재.
 * 데모 비밀번호(Basic Auth, middleware)로 보호되는 환경에서만 허용한다.
 */
export async function POST(req: Request) {
  if (!process.env.DEMO_PASSWORD) {
    return Response.json({ error: "DEMO_PASSWORD를 설정한 환경에서만 사용할 수 있습니다." }, { status: 403 });
  }
  if (dbMode().mode === "missing") {
    return Response.json(
      { ok: false, error: "DB가 연결되어 있지 않습니다. Vercel Storage에서 Neon DB를 이 프로젝트에 연결(Connect)한 뒤 Redeploy 하세요." },
      { status: 400 },
    );
  }
  let bundle: SeedBundle;
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    const json = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    bundle = JSON.parse(json) as SeedBundle;
  } catch (e) {
    return Response.json({ ok: false, error: `파일을 읽지 못했습니다: ${String(e).slice(0, 200)}` }, { status: 400 });
  }
  try {
    await migrateDb();
  } catch (e) {
    return Response.json({ ok: false, error: `테이블 생성 실패: ${describeDbError(e)}` }, { status: 500 });
  }
  try {
    const result = await seedBundle(await db(), bundle);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: `적재 실패: ${describeDbError(e)}` }, { status: 500 });
  }
}
