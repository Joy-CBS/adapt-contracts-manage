import Link from "next/link";
import { Empty, Panel, Pill, VerdictPill, formatAmount } from "@/components/ui";
import { archiveList, archiveTotals, archiveTypes } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SP = Promise<{ type?: string; q?: string; check?: string }>;

export default async function ArchivePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [types, totals, rows] = await Promise.all([archiveTypes(), archiveTotals(), archiveList({ type: sp.type, q: sp.q, check: sp.check === "1" })]);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/archive${s ? `?${s}` : ""}`;
  };
  const current = types.find((t) => t.key === sp.type);
  const std = types.filter((t) => t.hasStandard);
  const noStd = types.filter((t) => !t.hasStandard);

  const TypeLink = ({ t }: { t: (typeof types)[number] }) => (
    <li>
      <Link
        href={href({ type: t.key, check: undefined })}
        aria-current={sp.type === t.key ? "true" : undefined}
        className={`flex items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm ${sp.type === t.key ? "bg-ink text-white" : "hover:bg-white"}`}
      >
        <span className="min-w-0 truncate">{t.name}</span>
        <span className={`shrink-0 tabular-nums ${sp.type === t.key ? "text-white/80" : "text-slate"}`}>{t.n}</span>
      </Link>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">계약서 보관함</h1>
        <p className="mt-2 leading-relaxed text-ink-soft">
          기존 계약서 {totals.total}건을 어댑트 분류체계로 정리했습니다. {totals.standard}건은 어댑트 표준이 있는 유형, {totals.noStandard}건은 표준이 아직 없는 유형입니다.
          계약서를 열면 표준과 다른 조항과 표준양식 수정본을 볼 수 있습니다.
        </p>
      </div>

      {totals.check > 0 && (
        <Link
          href={href({ check: sp.check === "1" ? undefined : "1", type: undefined })}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${sp.check === "1" ? "border-ink bg-white" : "border-caution/40 bg-caution-tint/50 hover:border-caution"}`}
        >
          <span>
            <b className="font-semibold text-caution">분류 확인 필요 {totals.check}건</b> · AI 분류 근거가 약한 계약서입니다. 열어서 유형이 맞는지 확인해 주세요.
          </span>
          <span className="font-medium">{sp.check === "1" ? "전체 보기" : "확인하러 가기 →"}</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <nav aria-label="유형" className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <Link href={href({ type: undefined, check: undefined })} className={`block rounded-md px-2.5 py-1.5 text-sm font-medium ${!sp.type && sp.check !== "1" ? "bg-ink text-white" : "hover:bg-white"}`}>
            전체 <span className="font-normal opacity-70">{totals.total}</span>
          </Link>
          <div>
            <h2 className="px-2.5 text-xs font-semibold text-slate">어댑트 표준 있음</h2>
            <ul className="mt-1">
              {std.map((t) => (
                <TypeLink key={t.key} t={t} />
              ))}
            </ul>
          </div>
          {noStd.length > 0 && (
            <div>
              <h2 className="px-2.5 text-xs font-semibold text-slate">표준 없음 (제정 검토 대상)</h2>
              <ul className="mt-1">
                {noStd.map((t) => (
                  <TypeLink key={t.key} t={t} />
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="min-w-0 space-y-4">
          <form action="/archive" className="flex flex-wrap items-center gap-2">
            {sp.type && <input type="hidden" name="type" value={sp.type} />}
            <label htmlFor="q" className="sr-only">
              검색
            </label>
            <input id="q" name="q" defaultValue={sp.q} placeholder="상대방·파일명으로 찾기" className="h-9 w-64 rounded-md border border-line bg-white px-3 text-sm" />
            <button className="h-9 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink-soft">찾기</button>
            <span className="ml-auto text-sm text-slate">
              {current ? `${current.name} · ` : ""}
              {rows.length}건
            </span>
          </form>
          {current && (
            <p className="text-sm text-slate">
              {current.hasStandard ? `어댑트 표준 ${current.standardId} 기준으로 검토했습니다.` : "어댑트 표준이 없어 공통 기준으로 검토했습니다."}{" "}
              <Link href={`/standards/${current.key}`} className="text-insert hover:underline">
                이 유형의 표준·조항별 현황 보기
              </Link>
            </p>
          )}
          {rows.length === 0 ? (
            <Empty>조건에 맞는 계약서가 없습니다.</Empty>
          ) : (
            <Panel>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/archive/${r.id}`} className="grid gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:grid-cols-[1fr_auto] sm:items-center">
                      <span className="min-w-0">
                        <span className="block truncate font-medium" title={r.filename}>
                          {r.counterparty || r.title || r.filename}
                        </span>
                        <span className="block truncate text-xs text-slate">
                          {[!current ? r.categoryName : null, r.signed, r.amount ? formatAmount(r.amount, r.currency) : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {r.classifyState === "suggested" && <Pill cls="bg-caution-tint text-caution">분류 확인 필요</Pill>}
                        {(r.risk ?? 0) > 0 && <span className="text-xs text-redline">수정 필요 {r.risk}</span>}
                        {(r.lawyer ?? 0) > 0 && <span className="text-xs text-caution">변호사 확인 {r.lawyer}</span>}
                        <VerdictPill verdict={r.verdict} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
