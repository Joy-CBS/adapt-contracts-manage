import Link from "next/link";
import { CLASSIFY_STATE, Empty, LANG, LevelPill, Panel, Pill, VerdictPill, formatAmount } from "@/components/ui";
import { listCategories, listContracts, overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; category?: string; verdict?: string; state?: string }>;

export default async function ContractsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [rows, cats, o] = await Promise.all([listContracts(sp), listCategories(), overview()]);

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/contracts${s ? `?${s}` : ""}`;
  };
  const tabs = [
    { key: undefined, label: "전체", n: o.contracts },
    { key: "red", label: "수정 필요", n: o.red },
    { key: "yellow", label: "변호사 확인", n: o.yellow },
    { key: "green", label: "기준 충족", n: o.green },
  ];
  const control = "h-9 rounded-md border border-line bg-white px-3 text-sm";

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">계약서</h1>
        <p className="mt-3 text-ink-soft">
          확정 기준을 벗어난(수정 필요) 계약부터 보여줍니다. 계약서를 열면 항목별 판단 이유와 변호사 질문, 표준양식 변경기록(.docx)을 받을 수 있습니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line">
        {tabs.map((t) => {
          const active = (sp.verdict ?? undefined) === t.key;
          return (
            <Link
              key={t.label}
              href={href({ verdict: t.key })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2.5 text-sm ${active ? "border-ink font-medium" : "border-transparent text-slate hover:text-ink"}`}
            >
              {t.label} <span className="tabular-nums text-slate">{t.n}</span>
            </Link>
          );
        })}
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/contracts">
        {sp.verdict && <input type="hidden" name="verdict" value={sp.verdict} />}
        <label className="sr-only" htmlFor="q">
          검색
        </label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="파일명으로 찾기" className={`${control} w-56`} />
        <label className="sr-only" htmlFor="category">
          유형
        </label>
        <select id="category" name="category" defaultValue={sp.category ?? ""} className={control}>
          <option value="">모든 유형</option>
          {cats.map((c) => (
            <option key={c.classKey} value={c.classKey}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="state">
          분류 상태
        </label>
        <select id="state" name="state" defaultValue={sp.state ?? ""} className={control}>
          <option value="">모든 분류 상태</option>
          <option value="pending">승인 대기</option>
          <option value="decided">확정됨</option>
          <option value="rereview">재검토 필요</option>
        </select>
        <button className="h-9 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink-soft">찾기</button>
        {(sp.q || sp.category || sp.state) && (
          <Link href={href({ q: undefined, category: undefined, state: undefined })} className="text-sm text-slate hover:text-ink">
            조건 지우기
          </Link>
        )}
        <span className="ml-auto text-sm text-slate">{rows.length}건</span>
      </form>

      {rows.length === 0 ? (
        <Empty>조건에 맞는 계약서가 없습니다. 조건을 지우고 다시 찾아보세요.</Empty>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-line text-left text-slate">
              <tr>
                <th className="px-4 py-2.5 font-normal">상대방</th>
                <th className="px-4 py-2.5 font-normal">유형 · 분류 상태</th>
                <th className="px-4 py-2.5 text-right font-normal">금액</th>
                <th className="px-4 py-2.5 text-right font-normal">수정 필요</th>
                <th className="px-4 py-2.5 text-right font-normal">변호사 확인</th>
                <th className="px-4 py-2.5 font-normal">판정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const cs = CLASSIFY_STATE[r.classifyState];
                return (
                  <tr key={r.id} className="group hover:bg-paper">
                    <td className="max-w-[320px] px-4 py-3">
                      <Link href={`/contracts/${r.id}`} className="block truncate font-medium group-hover:underline" title={r.filename}>
                        {r.counterparty || r.title || r.filename}
                      </Link>
                      <span className="block truncate text-xs text-slate">{LANG[r.language ?? ""] ?? r.language}</span>
                    </td>
                    <td className="max-w-[300px] px-4 py-3">
                      <span className="block truncate">{r.categoryName ?? "–"}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <Pill cls={cs.cls}>{cs.label}</Pill>
                        {r.classifyState === "suggested" && <LevelPill level={r.level} />}
                        {r.needsReReview && <Pill cls="bg-insert-tint text-insert">재검토 필요</Pill>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-soft">{formatAmount(r.amount, r.currency)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${r.risk ? "font-semibold text-redline" : "text-slate"}`}>{r.risk ?? "–"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={r.lawyer ? "text-caution" : "text-slate"}>{r.lawyer ?? "–"}</span>
                      {r.lawyerOpen > 0 && <span className="block text-xs text-slate">요청 전 {r.lawyerOpen}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <VerdictPill verdict={r.verdict} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
