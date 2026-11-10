"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "표준화 현황", match: (p: string) => p === "/" },
  { href: "/categories", label: "표준계약서", match: (p: string) => p.startsWith("/categories") },
  { href: "/contracts", label: "계약서 검토", match: (p: string) => p.startsWith("/contracts") },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="flex h-full gap-1 text-sm">
      {items.map((it) => {
        const active = it.match(path);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-full items-center whitespace-nowrap border-b-2 px-1.5 sm:px-2 ${
              active ? "border-ink font-medium text-ink" : "border-transparent text-slate hover:text-ink"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 헤더 오른쪽: 접속 보호가 켜져 있을 때만 로그아웃 표시 */
export function AccountLink({ authEnabled }: { authEnabled: boolean }) {
  const path = usePathname();
  if (!authEnabled || path === "/login") return null;
  return (
    <a href="/api/auth/logout" className="whitespace-nowrap text-xs text-slate hover:text-ink">
      로그아웃
    </a>
  );
}
