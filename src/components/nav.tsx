"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 업무 단위 메뉴 3개: 새 계약서 검토(메인) · 기존 계약서 정리 · 표준계약서 */
const items = [
  { href: "/", label: "검토 요청", match: (p: string) => p === "/" || p.startsWith("/requests") },
  { href: "/archive", label: "계약서 보관함", match: (p: string) => p.startsWith("/archive") },
  { href: "/standards", label: "표준계약서", match: (p: string) => p.startsWith("/standards") },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="-mx-1 flex h-full gap-0.5 overflow-x-auto text-sm sm:gap-2">
      {items.map((it) => {
        const active = it.match(path);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-full items-center whitespace-nowrap border-b-2 px-1.5 sm:px-2 ${
              active ? "border-ink font-semibold text-ink" : "border-transparent text-slate hover:text-ink"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 헤더 오른쪽: 새 검토 요청 버튼 + 로그아웃 */
export function HeaderActions({ authEnabled }: { authEnabled: boolean }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <div className="ml-auto flex items-center gap-3">
      {path !== "/requests/new" && (
        <Link href="/requests/new" className="hidden whitespace-nowrap rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft sm:inline-flex">
          + 새 검토 요청
        </Link>
      )}
      {authEnabled && (
        <a href="/api/auth/logout" className="whitespace-nowrap text-xs text-slate hover:text-ink">
          로그아웃
        </a>
      )}
    </div>
  );
}
