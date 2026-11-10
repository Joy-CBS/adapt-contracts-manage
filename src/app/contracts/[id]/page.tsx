import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, LANG, Panel, Pill, SEVERITY, VerdictPill, formatAmount } from "@/components/ui";
import type { ClauseReview } from "@/lib/contracts";
import { getContract } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SP = Promise<{ show?: string }>;

const FACTS: Array<[string, string]> = [
  ["counterparty_type", "상대방 유형"],
  ["adapt_entity", "어댑트 측"],
  ["brands", "브랜드"],
  ["channels", "채널"],
  ["territory", "지역"],
  ["term", "계약 기간"],
  ["secondary_use_period", "2차 활용"],
  ["payment_terms", "지급 조건"],
];

const STATUS: Record<string, string> = { 일탈: "기준에서 벗어남", 누락: "조항 없음", 추가조항: "표준안에 없는 조항", 일치: "표준과 일치" };
const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

function ClauseCard({ x }: { x: ClauseReview }) {
  const sev = SEVERITY[x.severity] ?? SEVERITY.none;
  const accent = x.severity === "high" ? "border-l-redline" : x.severity === "medium" ? "border-l-caution" : "border-l-insert/40";
  return (
    <article className={`rounded-lg border border-l-4 border-line bg-white ${accent}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <h3 className="font-semibold">
          {x.standard_clause_no > 0 && <span className="mr-1.5 font-normal text-slate">제{x.standard_clause_no}조</span>}
          {x.standard_clause_title.replace(/^제\d+조\s*/, "")}
        </h3>
        <Pill cls={sev.cls}>리스크 {sev.label}</Pill>
        <span className="text-xs text-slate">{STATUS[x.status] ?? x.status}</span>
      </header>
      <p className="px-5 pt-2 text-sm leading-relaxed text-ink-soft">{x.issue}</p>
      <div className="mt-3 space-y-3 border-t border-line px-5 py-4 font-serif text-[0.95rem] leading-[1.85]">
        {x.contract_excerpt ? (
          <p className="whitespace-pre-line">
            <span className="redline-del">{x.contract_excerpt}</span>
          </p>
        ) : (
          <p className="font-sans text-sm text-slate">계약서에 해당 조항이 없습니다. 아래 문구를 추가합니다.</p>
        )}
        {x.suggestion && (
          <p className="whitespace-pre-line">
            <span className="redline-ins">{x.suggestion}</span>
          </p>
        )}
        {x.suggestion_ko && x.suggestion_ko !== x.suggestion && (
          <p className="whitespace-pre-line font-sans text-sm leading-relaxed text-slate">국문: {x.suggestion_ko}</p>
        )}
      </div>
    </article>
  );
}

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { show } = await searchParams;
  const data = await getContract(id);
  if (!data) notFound();
  const { contract: c, category, review, template } = data;
  const m = c.metadata;
  const r = review?.result;
  const issues = (r?.clause_reviews.filter((x) => x.status !== "일치") ?? []).sort(
    (a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || a.standard_clause_no - b.standard_clause_no,
  );
  const ok = r?.clause_reviews.filter((x) => x.status === "일치") ?? [];
  const filters = [
    { key: undefined, label: "모두", n: issues.length },
    { key: "high", label: "높음", n: issues.filter((x) => x.severity === "high").length },
    { key: "medium", label: "중간", n: issues.filter((x) => x.severity === "medium").length },
    { key: "low", label: "낮음", n: issues.filter((x) => x.severity === "low").length },
  ];
  const shown = show ? issues.filter((x) => x.severity === show) : issues;
  const name = String(m.counterparty_name || m.contract_title || c.filename);

  return (
    <div>
      <Crumbs items={[{ href: "/contracts", label: "계약서 검토" }, { label: name }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
            <VerdictPill verdict={review?.verdict} size="lg" />
          </div>
          <p className="mt-2 text-sm text-slate">
            {m.contract_title ? `${m.contract_title}, ` : ""}
            {formatAmount(m.amount, m.currency)}, {LANG[c.language ?? ""] ?? c.language}
          </p>
          <p className="mt-0.5 break-all text-xs text-slate/80">{c.filename}</p>
        </div>
        {review && (
          <a
            href={`/api/contracts/${c.id}/redline`}
            className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink-soft"
          >
            Word 변경기록 받기
          </a>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {!review && <Panel className="p-6 text-sm text-slate">아직 리스크 검토 결과가 없습니다.</Panel>}

          {r && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">고칠 조항 {issues.length}개</h2>
                <div className="flex gap-1 rounded-md bg-line/50 p-1 text-sm" role="tablist" aria-label="리스크 수준으로 거르기">
                  {filters.map((f) => {
                    const active = show === f.key;
                    return (
                      <Link
                        key={f.label}
                        href={f.key ? `?show=${f.key}` : "?"}
                        scroll={false}
                        aria-current={active ? "true" : undefined}
                        className={`rounded px-2.5 py-1 ${active ? "bg-white font-medium shadow-sm" : "text-slate hover:text-ink"}`}
                      >
                        {f.label} <span className="tabular-nums text-slate">{f.n}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
                <span>
                  <span className="redline-del">취소선</span> 지금 계약서 문구
                </span>
                <span>
                  <span className="redline-ins">밑줄</span> 수정 제안 (Word 파일에도 같은 변경 기록으로 들어갑니다)
                </span>
              </p>
              <div className="space-y-4">
                {shown.map((x, i) => (
                  <ClauseCard key={`${x.standard_clause_no}-${i}`} x={x} />
                ))}
              </div>
              {ok.length > 0 && (
                <details className="rounded-lg border border-line bg-white px-5 py-4 text-sm">
                  <summary className="cursor-pointer">
                    표준과 일치하는 조항 <b className="font-medium text-comply">{ok.length}개</b>
                  </summary>
                  <ul className="mt-3 grid gap-1.5 text-ink-soft sm:grid-cols-2">
                    {ok.map((x, i) => (
                      <li key={i}>
                        제{x.standard_clause_no}조 {x.standard_clause_title.replace(/^제\d+조\s*/, "")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {r && (
            <Panel className="p-5">
              <h2 className="text-sm font-semibold">검토 의견</h2>
              <p className="mt-2 text-sm leading-relaxed">{r.overall_opinion}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
                {(["high", "medium", "low"] as const).map((k) => (
                  <div key={k}>
                    <dd className={`text-xl font-semibold tabular-nums ${k === "high" ? "text-redline" : k === "medium" ? "text-caution" : "text-insert"}`}>
                      {k === "high" ? review?.highCount : k === "medium" ? review?.mediumCount : review?.lowCount}
                    </dd>
                    <dt className="text-xs text-slate">리스크 {SEVERITY[k].label}</dt>
                  </div>
                ))}
              </dl>
              {r.is_high_value && <p className="mt-3 rounded bg-insert-tint px-2.5 py-1.5 text-xs text-insert">1억 원 이상 계약: 검토 강도를 높여야 합니다</p>}
            </Panel>
          )}

          <Panel className="p-5 text-sm">
            <h2 className="font-semibold">비교 기준</h2>
            {category ? (
              <Link href={`/categories/${category.classKey}`} className="mt-1 block text-insert hover:underline">
                {category.name}
              </Link>
            ) : (
              <p className="mt-1 text-slate">유형 미분류</p>
            )}
            <p className="mt-1 text-xs text-slate">
              {template ? `${template.title_ko} (${template.status === "confirmed" ? "확정" : "초안"})` : "표준안 없음"}
              {c.classifyConfidence != null && `, 유형 판단 신뢰도 ${Math.round(c.classifyConfidence * 100)}%`}
            </p>
          </Panel>

          <Panel className="p-5 text-sm">
            <h2 className="font-semibold">계약 정보</h2>
            <dl className="mt-3 space-y-2.5">
              {FACTS.map(([k, label]) => {
                const v = m[k];
                const s = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                if (!s) return null;
                return (
                  <div key={k}>
                    <dt className="text-xs text-slate">{label}</dt>
                    <dd className="mt-0.5 leading-relaxed">{s}</dd>
                  </div>
                );
              })}
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
