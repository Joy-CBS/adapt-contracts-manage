/**
 * 데모 접속 보호(아이디·비밀번호 1회 입력 → 서명된 쿠키로 유지).
 * - DEMO_PASSWORD가 없으면 보호하지 않는다(로컬 개발).
 * - 아이디는 DEMO_USER(기본값 "cb"), 비밀번호는 DEMO_PASSWORD 환경 변수로만 설정한다. 코드에 비밀번호를 두지 않는다.
 * - 미들웨어(Edge)와 API 라우트(Node) 양쪽에서 쓰도록 Web Crypto만 사용한다.
 */

export const SESSION_COOKIE = "acr_session";
export const SESSION_DAYS = 30;

/**
 * 설정값 입력 실수 보정: 앞뒤 공백·줄바꿈, 값 전체를 감싼 따옴표("..." 또는 '...')를 걷어낸다.
 * (Vercel 화면에 .env 형식 그대로 따옴표째 붙여 넣는 경우가 흔하다)
 */
export function cleanSecret(v: string) {
  let s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1).trim();
  return s;
}

export function authConfig() {
  const password = cleanSecret(process.env.DEMO_PASSWORD ?? "");
  if (!password) return null;
  return { user: cleanSecret(process.env.DEMO_USER || "cb"), password };
}

const enc = new TextEncoder();

/** 길이와 무관하게 끝까지 비교해 비교 시간으로 값이 드러나지 않게 한다 */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * 아이디는 대소문자를 구분하지 않고, 둘 다 앞뒤 공백은 무시한다.
 * 데모용 단일 계정이라 어느 쪽이 틀렸는지 알려 줘 설정 오류를 빨리 찾게 한다.
 */
export function checkCredentials(user: string, password: string): { ok: boolean; wrong?: "user" | "password" } {
  const cfg = authConfig();
  if (!cfg) return { ok: true };
  const okUser = safeEqual(user.trim().toLowerCase(), cfg.user.toLowerCase());
  const okPass = safeEqual(password.trim(), cfg.password);
  if (okUser && okPass) return { ok: true };
  return { ok: false, wrong: okUser ? "password" : "user" };
}

async function sign(message: string) {
  const cfg = authConfig()!;
  // 비밀번호·아이디가 바뀌면 기존 로그인은 모두 무효가 된다
  const secret = `${cfg.user}\u0000${cfg.password}\u0000${process.env.AUTH_SECRET ?? ""}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken(days = SESSION_DAYS) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = `v1.${exp}`;
  return `${body}.${await sign(body)}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token || !authConfig()) return false;
  const [v, expStr, sig] = token.split(".");
  if (v !== "v1" || !expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  return safeEqual(sig, await sign(`v1.${expStr}`));
}

/** curl 등 프로그램 접근용: Authorization: Basic 헤더도 허용 */
export function checkBasicHeader(header: string | null) {
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6).trim());
    const i = decoded.indexOf(":");
    if (i < 0) return false;
    return checkCredentials(decoded.slice(0, i), decoded.slice(i + 1)).ok;
  } catch {
    return false;
  }
}

/** 로그인 후 이동할 경로: 같은 사이트 안의 경로만 허용 */
export function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/auth")) return "/";
  return next;
}
