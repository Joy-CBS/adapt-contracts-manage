import Link from "next/link";
import { notFound } from "next/navigation";
import { CLASSIFY_STATE, Crumbs, GRADE, Panel, Pill, Section, VerdictPill, pct } from "@/components/ui";
import { clauseStats, getCategory, listContracts } from "@/lib/queries";

export const dynamic = "force-dynamic";

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export default async function CategoryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await getCategory(key);
  if (!data) notFound();
  const { category: c, standard: s, subtypes, subCounts } = data;
  const [members, stats] = await Promise.all([listContracts({ category: key }), clauseStats(key)]);
  const statOf = new Map(stats.map((x) => [x.clause, x]));
  const reviewed = stats[0]?.reviewed ?? 0;
  const red = members.filter((m) => m.verdict === "red").length;
  const yellow = members.filter((m) => m.verdict === "yellow").length;
  const subN = new Map(subCounts.map((x) => [x.id, x.n]));
  const inc = list(c.includeSignals);
  const exc = list(c.excludeSignals);

  return (
    <div className="space-y-10">
      <div>
        <Crumbs items={[{ href: "/categories", label: "표준계약서" }, { label: c.name }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{c.name}</h1>
          {c.hasStandard ? (
            <Pill cls="bg-comply-tint text-comply">어댑트 표준 {c.standardId}</Pill>
          ) : key === "others" ? (
            <Pill>공통 기준 검토</Pill>
          ) : (
            <Pill cls="bg-caution-tint text-caution">표준 없음 · 제정 필요</Pill>
          )}
        </div>
        <p className="mt-3 max-w-[72ch] leading-relaxed text-ink-soft">{c.definition}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Panel className="p-4">
            <div className="text-sm text-slate">이 유형의 계약서</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {members.length}건{c.estimate ? <span className="text-base font-normal text-slate"> · 전체 추정 {c.estimate.toLocaleString()}건</span> : null}
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="text-sm text-slate">수정 필요</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-redline">
              {pct(red, members.length)}%<span className="text-base font-normal text-slate"> · {red}건</span>
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="text-sm text-slate">변호사 확인</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-caution">
              {pct(yellow, members.length)}%<span className="text-base font-normal text-slate"> · {yellow}건</span>
            </div>
          </Panel>
        </div>

        {(inc.length > 0 || exc.length > 0) && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate hover:text-ink">분류 기준(어댑트 분류체계 포함·제외 신호) 보기</summary>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-medium">포함 신호</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-soft">
                  {inc.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">제외 신호</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-soft">
                  {exc.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        )}
      </div>

      {s && (
        <Section title={`표준계약서: ${s.title}`} desc={`어댑트 원본 ${s.sourceFile} (버전 ${s.version}). 플레이북 조항별 등급과 검토 결과 분포입니다.`}>
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-line text-left text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-normal">조항</th>
                  <th className="px-4 py-2.5 font-normal">등급</th>
                  <th className="px-4 py-2.5 text-right font-normal">수정 필요</th>
                  <th className="px-4 py-2.5 text-right font-normal">변호사 확인</th>
                  <th className="px-4 py-2.5 text-right font-normal">계약서에 없음</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.clauses.map((cl) => {
                  const st = statOf.get(cl.title);
                  return (
                    <tr key={cl.title}>
                      <td className="px-4 py-2.5">{cl.title}</td>
                      <td className={`px-4 py-2.5 text-xs font-medium ${GRADE[cl.grade]?.cls ?? ""}`}>{GRADE[cl.grade]?.label || "–"}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${st?.risk ? "text-redline" : "text-slate"}`}>{st ? st.risk : "–"}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${st?.lawyer ? "text-caution" : "text-slate"}`}>{st ? st.lawyer : "–"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate">{st ? st.missing : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2.5 text-xs text-slate">검토한 계약 {reviewed}건 기준. 등급은 플레이북 표시(필수=이탈 시 변호사 판단, 협상가능=허용 범위 안이면 수용).</p>
          </Panel>
          {s.checklist.length > 0 && (
            <Panel className="p-5">
              <h3 className="text-sm font-semibold">필수 체크리스트 (플레이북 3절)</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                {s.checklist.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </Panel>
          )}
          <details className="rounded-lg border border-line bg-white px-5 py-4">
            <summary className="cursor-pointer text-sm">표준계약서 원문 보기 ({s.paragraphs.length}개 문단)</summary>
            <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto text-[0.95rem] leading-relaxed">
              {s.paragraphs.map((p) => (
                <p key={p.id} className={/^(제\d+조|ARTICLE|Article)/.test(p.text) ? "pt-2 font-semibold" : "text-ink-soft"}>
                  {p.text}
                </p>
              ))}
            </div>
          </details>
        </Section>
      )}

      {!s && stats.length > 0 && (
        <Section title="검토 항목별 결과" desc={key === "others" ? "공통 포지션 항목별 결과입니다." : "공통 포지션 + 유사 표준(INF-PAID) 참고 항목별 결과입니다."}>
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b border-line text-left text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-normal">항목</th>
                  <th className="px-4 py-2.5 text-right font-normal">수정 필요</th>
                  <th className="px-4 py-2.5 text-right font-normal">변호사 확인</th>
                  <th className="px-4 py-2.5 text-right font-normal">계약서에 없음</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((st) => (
                  <tr key={st.clause}>
                    <td className="px-4 py-2.5">{st.clause}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${st.risk ? "text-redline" : "text-slate"}`}>{st.risk}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${st.lawyer ? "text-caution" : "text-slate"}`}>{st.lawyer}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate">{st.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Section>
      )}

      {key === "others" && subtypes.length > 0 && (
        <Section title="기타에 포함된 세부 유형" desc="어댑트 분류체계 49종 중 상위 5종을 뺀 유형입니다. AI가 추정한 세부 유형별 계약 수입니다.">
          <Panel>
            <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
              {subtypes
                .sort((a, b) => (subN.get(b.id) ?? 0) - (subN.get(a.id) ?? 0))
                .map((st) => (
                  <li key={st.id} className="flex items-baseline justify-between gap-3 border-line px-4 py-2.5 text-sm sm:border-b">
                    <span>
                      {st.nameKo}
                      {st.standardId && <span className="ml-1.5 text-xs text-slate">{st.standardId}</span>}
                    </span>
                    <span className="tabular-nums text-slate">{subN.get(st.id) ?? 0}</span>
                  </li>
                ))}
            </ul>
          </Panel>
        </Section>
      )}

      <Section title={`계약서 ${members.length}건`}>
        <Panel>
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.id}>
                <Link href={`/contracts/${m.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.counterparty || m.title || m.filename}</div>
                    <div className="truncate text-xs text-slate">{m.filename}</div>
                  </div>
                  <Pill cls={CLASSIFY_STATE[m.classifyState].cls}>{CLASSIFY_STATE[m.classifyState].label}</Pill>
                  <span className="hidden w-28 text-right text-xs text-slate sm:block">
                    수정 {m.risk ?? 0} · 변호사 {m.lawyer ?? 0}
                  </span>
                  <VerdictPill verdict={m.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </Section>
    </div>
  );
}
