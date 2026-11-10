import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfig, checkBasicHeader, verifySessionToken } from "@/lib/auth";

/**
 * 외부 공유용 데모 보호.
 * DEMO_PASSWORD가 설정되면 로그인 화면에서 아이디·비밀번호를 한 번 입력하고, 이후에는 서명된 쿠키로 통과한다.
 * Slack 이벤트 웹훅(/api/slack/*)은 Slack 서명 검증으로 따로 보호하므로 제외한다.
 */
export async function middleware(req: NextRequest) {
  if (!authConfig()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  if ((await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) || checkBasicHeader(req.headers.get("authorization"))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" && !search ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/slack|_next/static|_next/image|favicon.ico).*)"],
};
