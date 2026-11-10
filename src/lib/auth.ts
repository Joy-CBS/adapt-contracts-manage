/**
 * 데모 접속 보호(아이디·비밀번호 1회 입력 → 서명된 쿠키로 유지).
 * - DEMO_PASSWORD가 없으면 보호하지 않는다(로컬 개발).
 * - 아이디는 DEMO_USER(기본값 "cb"), 비밀번호는 DEMO_PASSWORD 환경 변수로만 설정한다. 코드에 비밀번호를 두지 않는다.
 * - 미들웨어(Edge)와 API 라우트(Node) 양쪽에서 쓰도록 Web Crypto만 사용한다.
 */

export const SESSION_COOKIE = "acr_session";
export const SESSION_DAYS = 30;

export function authConfig() {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return null;
  return { user: process.env.DEMO_USER || "cb", password };
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

export function checkCredentials(user: string, password: string) {
  const cfg = authConfig();
  if (!cfg) return true;
  // 두 비교를 모두 수행(단락 평가로 아이디 일치 여부가 드러나지 않게)
  const okUser = safeEqual(user.trim(), cfg.user);
  const okPass = safeEqual(password, cfg.password);
  return okUser && okPass;
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
    return checkCredentials(decoded.slice(0, i), decoded.slice(i + 1));
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
