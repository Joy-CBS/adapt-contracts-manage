import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, LANG, Panel, Pill, RiskBar, Section, VerdictPill, pct } from "@/components/ui";
import { clauseStats, getCategory, listContracts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await getCategory(key);
  if (!data) notFound();
  const { category: c, template: t } = data;
  const [members, stats] = await Promise.all([listContracts({ category: key }), clauseStats(key)]);
  const byNo = new Map(stats.map((s) => [s.no, s]));
  const reviewed = stats[0]?.reviewed ?? 0;
  const red = members.filter((m) => m.verdict === "red").length;

  return (
    <div className="space-y-10">
      <div>
        <Crumbs items={[{ href: "/categories", label: "표준계약서" }, { label: c.name }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{c.name}</h1>
          {t && <Pill>{t.status === "confirmed" ? "표준안 확정" : "표준안 초안"}</Pill>}
          {!c.standardizable && <Pill cls="bg-caution-tint text-caution">정형화 어려움</Pill>}
        </div>
        <p className="mt-3 max-w-[70ch] text-ink-soft">{c.definition}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Panel className="p-4">
            <div className="text-sm text-slate">이 유형의 계약서</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{members.length}건</div>
          </Panel>
          <Panel className="p-4">
            <div className="text-sm text-slate">수정이 필요한 계약</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-redline">
              {pct(red, members.length)}%<span className="text-base font-normal text-slate"> · {red}건</span>
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="text-sm text-slate">표준화 판단</div>
            <p className="mt-1 line-clamp-3 text-sm">{c.standardizableReason}</p>
          </Panel>
        </div>

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate hover:text-ink">이 유형에 포함·제외되는 기준 보기</summary>
          <dl className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="font-medium">포함</dt>
              <dd className="mt-1 text-ink-soft">{c.includeCriteria}</dd>
            </div>
            <div>
              <dt className="font-medium">제외</dt>
              <dd className="mt-1 text-ink-soft">{c.excludeCriteria}</dd>
            </div>
          </dl>
        </details>
      </div>

      <Section
        title={t ? t.title_ko : "표준안"}
        desc={
          reviewed
            ? `조항마다 기존 계약서 ${reviewed}건 중 몇 건이 이 기준에서 벗어났는지 표시합니다. 조항을 누르면 표준 문구와 가드레일이 보입니다.`
            : "조항을 누르면 표준 문구와 가드레일이 보입니다."
        }
      >
        {!t ? (
          <p className="text-sm text-slate">아직 표준안이 없습니다.</p>
        ) : (
          <Panel>
            <ul className="divide-y divide-line">
              {t.clauses.map((cl) => {
                const s = byNo.get(cl.no);
                const rate = s ? pct(s.deviate, s.reviewed) : 0;
                const highRate = s ? pct(s.high, s.reviewed) : 0;
                return (
                  <li key={cl.no} id={`clause-${cl.no}`} className="scroll-mt-20">
                    <details className="group">
                      <summary className="grid cursor-pointer list-none grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-paper md:grid-cols-[3.5rem_1fr_14rem_5rem]">
                        <span className="text-sm tabular-nums text-slate">제{cl.no}조</span>
                        <span className="font-medium">
                          {cl.title_ko}
                          {cl.kind === "commercial" && <span className="ml-2 text-xs font-normal text-slate">거래 조건</span>}
                        </span>
                        {s ? (
                          <>
                            <span className="col-start-2 flex items-center gap-2 md:col-start-auto" title={`벗어남 ${s.deviate}건 중 고위험 ${s.high}건`}>
                              <span className="flex h-2 w-full overflow-hidden rounded-full bg-line/70">
                                <span className="bg-redline" style={{ width: `${highRate}%` }} />
                                <span className="bg-caution" style={{ width: `${Math.max(0, rate - highRate)}%` }} />
                              </span>
                            </span>
                            <span className="col-start-2 text-sm tabular-nums md:col-start-auto md:text-right">
                              <b className={`font-medium ${highRate >= 50 ? "text-redline" : "text-ink"}`}>{rate}%</b>
                              <span className="text-slate"> 벗어남</span>
                            </span>
                          </>
                        ) : (
                          <span className="col-start-2 text-sm text-slate md:col-span-2 md:col-start-auto">검토 결과 없음</span>
                        )}
                      </summary>
                      <div className="grid gap-6 border-t border-line bg-paper/60 px-4 py-5 md:grid-cols-[1.3fr_1fr] md:pl-[4.75rem]">
                        <div>
                          <div className="mb-2 text-sm font-medium text-slate">표준 문구</div>
                          <p className="whitespace-pre-line font-serif leading-relaxed">{cl.text_ko}</p>
                          <p className="mt-3 whitespace-pre-line font-serif text-sm leading-relaxed text-slate">{cl.text_en}</p>
                        </div>
                        <div className="space-y-4 text-sm">
                          <div>
                            <div className="mb-1 font-medium text-slate">가드레일</div>
                            <p className="whitespace-pre-line leading-relaxed">{cl.guardrail}</p>
                          </div>
                          <div>
                            <div className="mb-1 font-medium text-slate">벗어나면 생기는 리스크</div>
                            <p className="whitespace-pre-line leading-relaxed">{cl.risk_if_deviating}</p>
                          </div>
                          {s && (
                            <p className="text-slate">
                              기존 {s.reviewed}건 중 고위험 {s.high}건, 중간 {s.medium}건
                              {s.missing ? `, 조항 자체가 없는 계약 ${s.missing}건` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </Section>

      <Section title="이 유형의 계약서" desc="고위험 조항이 많은 순서입니다.">
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-slate">
              <tr>
                <th className="px-4 py-2.5 font-normal">상대방</th>
                <th className="px-4 py-2.5 font-normal">언어</th>
                <th className="px-4 py-2.5 font-normal">리스크 높음 / 중간</th>
                <th className="px-4 py-2.5 font-normal">판정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-paper">
                  <td className="max-w-[360px] px-4 py-2.5">
                    <Link href={`/contracts/${m.id}`} className="block truncate font-medium hover:underline">
                      {m.counterparty || m.title || m.filename}
                    </Link>
                    <span className="block truncate text-xs text-slate">{m.filename}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate">{LANG[m.language ?? ""] ?? m.language}</td>
                  <td className="px-4 py-2.5">
                    <RiskBar high={m.high} medium={m.medium} low={m.low} scale={16} />
                  </td>
                  <td className="px-4 py-2.5">
                    <VerdictPill verdict={m.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>
    </div>
  );
}
