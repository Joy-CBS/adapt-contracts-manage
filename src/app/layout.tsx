import type { Metadata } from "next";
import { AccountLink, Nav } from "@/components/nav";
// Pretendard(가변 글꼴, 한글 동적 서브셋): 필요한 글자 조각만 내려받는다
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "어댑트 계약 검토",
  description: "표준계약서 유형 분류와 조항별 리스크 검토",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-8">
            <span className="whitespace-nowrap font-semibold tracking-tight">
              어댑트<span className="hidden sm:inline"> 계약 검토</span>
            </span>
            <Nav />
            <span className="ml-auto hidden text-xs text-slate sm:inline">Upstage Studio 기반</span>
            <AccountLink authEnabled={Boolean(process.env.DEMO_PASSWORD)} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 md:py-10">{children}</main>
      </body>
    </html>
  );
}
