import { NextResponse, type NextRequest } from "next/server";

/**
 * 외부 공유용 데모 보호: DEMO_PASSWORD가 설정되면 Basic Auth를 요구한다.
 * Slack 이벤트 웹훅(/api/slack/*)은 Slack 서명 검증으로 따로 보호하므로 제외한다.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Adapt Contract Review PoC", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/slack|_next/static|_next/image|favicon.ico).*)"],
};
