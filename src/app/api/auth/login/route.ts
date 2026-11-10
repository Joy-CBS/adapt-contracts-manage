import { SESSION_COOKIE, SESSION_DAYS, authConfig, checkCredentials, createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authConfig()) return Response.json({ ok: true });
  let body: { user?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {}
  if (!checkCredentials(String(body.user ?? ""), String(body.password ?? ""))) {
    await new Promise((r) => setTimeout(r, 600)); // 연속 대입 속도를 늦춘다
    return Response.json({ ok: false, error: "아이디 또는 비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${await createSessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  );
  return res;
}
