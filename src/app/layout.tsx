import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "어댑트 계약서 검토",
  description: "Upstage Studio 기반 계약서 분류·리스크 검토 PoC",
};

const nav = [
  { href: "/", label: "개요" },
  { href: "/categories", label: "카테고리 맵" },
  { href: "/contracts", label: "계약서 목록" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <span className="font-medium">어댑트 계약서 검토</span>
            <nav className="flex gap-4 text-sm text-neutral-600">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-neutral-900">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-xs text-neutral-400">Powered by Upstage Studio</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
