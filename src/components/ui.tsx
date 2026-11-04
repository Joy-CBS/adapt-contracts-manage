import Link from "next/link";

export const VERDICT: Record<string, { label: string; cls: string }> = {
  red: { label: "수정 필요", cls: "bg-red-50 text-red-700 ring-red-200" },
  yellow: { label: "확인 필요", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  green: { label: "표준 부합", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

export const SEVERITY: Record<string, { label: string; cls: string }> = {
  high: { label: "높음", cls: "bg-red-50 text-red-700 ring-red-200" },
  medium: { label: "중간", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  low: { label: "낮음", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  none: { label: "없음", cls: "bg-neutral-50 text-neutral-500 ring-neutral-200" },
};

export const LANG: Record<string, string> = { ko: "한국어", en: "영어", zh: "중국어", ja: "일본어", mixed: "혼합", other: "기타" };

export function Badge({ children, cls }: { children: React.ReactNode; cls?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls ?? "bg-neutral-50 text-neutral-600 ring-neutral-200"}`}>
      {children}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) return <Badge>미검토</Badge>;
  const v = VERDICT[verdict] ?? { label: verdict, cls: undefined };
  return <Badge cls={v.cls}>{v.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? SEVERITY.none;
  return <Badge cls={s.cls}>{s.label}</Badge>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">{children}</div>;
}

export function Crumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-neutral-500">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-neutral-300">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-neutral-900">
              {it.label}
            </Link>
          ) : (
            <span className="text-neutral-800">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function formatAmount(amount?: unknown, currency?: unknown) {
  const n = Number(amount);
  if (!n) return "-";
  return `${n.toLocaleString("ko-KR")} ${currency ?? ""}`.trim();
}
