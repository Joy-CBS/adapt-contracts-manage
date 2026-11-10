import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authConfig, safeNext, verifySessionToken } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  // 보호가 꺼져 있거나 이미 로그인한 경우 바로 이동
  if (!authConfig() || (await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) redirect(target);

  return (
    <div className="mx-auto mt-6 max-w-sm md:mt-16">
      <h1 className="text-2xl font-semibold tracking-tight">로그인</h1>
      <p className="mt-2 text-sm text-ink-soft">전달받은 아이디와 비밀번호를 입력하세요. 이 브라우저에서는 30일 동안 다시 묻지 않습니다.</p>
      <LoginForm next={target} />
    </div>
  );
}
