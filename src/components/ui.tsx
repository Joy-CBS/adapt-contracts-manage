import Link from "next/link";

export const VERDICT: Record<string, { label: string; cls: string; dot: string }> = {
  red: { label: "수정 필요", cls: "bg-redline-tint text-redline", dot: "bg-redline" },
  yellow: { label: "변호사 확인", cls: "bg-caution-tint text-caution", dot: "bg-caution" },
  green: { label: "기준 충족", cls: "bg-comply-tint text-comply", dot: "bg-comply" },
};

export const DECISION: Record<string, { label: string; cls: string; border: string }> = {
  risk: { label: "수정 필요", cls: "bg-redline-tint text-redline", border: "border-l-redline" },
  needs_lawyer: { label: "변호사 확인", cls: "bg-caution-tint text-caution", border: "border-l-caution" },
  note: { label: "참고", cls: "bg-line/60 text-ink-soft", border: "border-l-line" },
  ok: { label: "기준 충족", cls: "bg-comply-tint text-comply", border: "border-l-comply" },
};

export const GRADE: Record<string, { label: string; cls: string }> = {
  high: { label: "필수", cls: "text-redline" },
  medium: { label: "협상가능", cls: "text-caution" },
  low: { label: "참고", cls: "text-slate" },
  none: { label: "", cls: "text-slate" },
};

export const LEVEL: Record<string, { label: string; cls: string; dot: string }> = {
  strong: { label: "근거 충분", cls: "bg-comply-tint text-comply", dot: "bg-comply" },
  medium: { label: "근거 보통", cls: "bg-insert-tint text-insert", dot: "bg-insert" },
  weak: { label: "확인 필요", cls: "bg-caution-tint text-caution", dot: "bg-caution" },
};

export const CLASSIFY_STATE: Record<string, { label: string; cls: string }> = {
  suggested: { label: "승인 대기", cls: "bg-caution-tint text-caution" },
  approved: { label: "승인됨", cls: "bg-comply-tint text-comply" },
  changed: { label: "담당자 변경", cls: "bg-insert-tint text-insert" },
};

export function DecisionPill({ decision }: { decision: string }) {
  const d = DECISION[decision] ?? DECISION.note;
  return <Pill cls={d.cls}>{d.label}</Pill>;
}

export function LevelPill({ level }: { level?: string | null }) {
  const l = LEVEL[level ?? ""];
  if (!l) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${l.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} aria-hidden />
      {l.label}
    </span>
  );
}

export const SEVERITY: Record<string, { label: string; cls: string; bar: string }> = {
  high: { label: "높음", cls: "bg-redline-tint text-redline", bar: "bg-redline" },
  medium: { label: "중간", cls: "bg-caution-tint text-caution", bar: "bg-caution" },
  low: { label: "낮음", cls: "bg-insert-tint text-insert", bar: "bg-insert/60" },
  none: { label: "일치", cls: "bg-comply-tint text-comply", bar: "bg-comply" },
};

export const LANG: Record<string, string> = { ko: "한국어", en: "영어", zh: "중국어", ja: "일본어", mixed: "혼합", other: "기타" };

export function Pill({ children, cls }: { children: React.ReactNode; cls?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls ?? "bg-line/60 text-ink-soft"}`}>
      {children}
    </span>
  );
}

export function VerdictPill({ verdict, size = "sm" }: { verdict?: string | null; size?: "sm" | "lg" }) {
  if (!verdict) return <Pill>미검토</Pill>;
  const v = VERDICT[verdict];
  if (!v) return <Pill>{verdict}</Pill>;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ${v.cls} ${size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} aria-hidden />
      {v.label}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? SEVERITY.none;
  return <Pill cls={s.cls}>{severity === "none" ? "일치" : `리스크 ${s.label}`}</Pill>;
}

/** 큰 행동 버튼(링크) */
export function CtaLink({ href, children, tone = "ink" }: { href: string; children: React.ReactNode; tone?: "ink" | "red" | "amber" | "ghost" }) {
  const cls = {
    ink: "bg-ink text-white hover:bg-ink-soft",
    red: "bg-redline text-white hover:opacity-90",
    amber: "bg-caution text-white hover:opacity-90",
    ghost: "border border-line bg-white text-ink hover:bg-paper",
  }[tone];
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium ${cls}`}>
      {children}
    </Link>
  );
}

/** 높음·중간·낮음 조항 수를 한 줄 막대로 */
export function RiskBar({ high = 0, medium = 0, low = 0, scale, showNumbers = true }: { high?: number | null; medium?: number | null; low?: number | null; scale?: number; showNumbers?: boolean }) {
  const h = high ?? 0;
  const m = medium ?? 0;
  const l = low ?? 0;
  const total = Math.max(scale ?? h + m + l, 1);
  const seg = (n: number, cls: string) => (n ? <span className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div className="flex items-center gap-2" aria-label={`리스크 높음 ${h}, 중간 ${m}, 낮음 ${l}`}>
      <div className="flex h-2 w-24 overflow-hidden rounded-full bg-line/70">
        {seg(h, "bg-redline")}
        {seg(m, "bg-caution")}
        {seg(l, "bg-insert/50")}
      </div>
      {showNumbers && (
        <span className="text-xs tabular-nums text-slate">
          <span className={h ? "font-medium text-redline" : ""}>{h}</span>
          <span className="text-line"> / </span>
          <span className={m ? "text-caution" : ""}>{m}</span>
        </span>
      )}
    </div>
  );
}

export function Meter({ value, max, cls = "bg-ink" }: { value: number; max: number; cls?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/70">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%` }} />
    </div>
  );
}

export function Section({ title, desc, children, action }: { title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {desc && <p className="mt-1 text-sm text-slate">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-white ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm text-slate">{children}</div>;
}

export function Crumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="위치" className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-slate">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>›</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-ink">
              {it.label}
            </Link>
          ) : (
            <span className="max-w-[48ch] truncate text-ink-soft">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function formatAmount(amount?: unknown, currency?: unknown) {
  const n = Number(amount);
  if (!n) return "–";
  const c = String(currency ?? "");
  if (c === "KRW" && n >= 10000) return `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만 원`;
  return `${n.toLocaleString("ko-KR")} ${c}`.trim();
}

export function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : 0;
}
