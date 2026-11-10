import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, GRADE, Panel, Pill, Section, pct } from "@/components/ui";
import { clauseStats, getStandard } from "@/lib/queries";

export const dynamic = "force-dynamic";

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export default async function StandardPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await getStandard(key);
  if (!data) notFound();
  const { category: c, standard: s } = data;
  const stats = await clauseStats(key);
  const statOf = new Map(stats.map((x) => [x.clause, x]));
  const reviewed = stats[0]?.reviewed ?? 0;
  const inc = list(c.includeSignals);
  const exc = list(c.excludeSignals);
  const rowsForTable = s ? s.clauses.map((cl) => ({ title: cl.title, grade: cl.grade, st: statOf.get(cl.title) })) : stats.map((st) => ({ title: st.clause, grade: null, st }));

  return (
    <div className="space-y-10">
      <div>
        <Crumbs items={[{ href: "/standards", label: "표준계약서" }, { label: c.name }]} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{c.name}</h1>
          {c.hasStandard ? <Pill cls="bg-comply-tint text-comply">어댑트 표준 {c.standardId}</Pill> : <Pill cls="bg-caution-tint text-caution">표준 없음 · 공통 기준으로 검토</Pill>}
        </div>
        <p className="mt-3 max-w-[72ch] leading-relaxed text-ink-soft">{c.definition}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/archive?type=${key}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-paper">
            이 유형의 계약서 보기
          </Link>
          {s && (
            <a href={`/api/standards/${key}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-paper">
              표준 원본(.docx) 받기
            </a>
          )}
        </div>
        {(inc.length > 0 || exc.length > 0) && (
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer text-slate hover:text-ink">AI가 이 유형으로 분류하는 기준(포함·제외 신호)</summary>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                {inc.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
              <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                {exc.map((x, i) => (
                  <li key={i}>제외: {x}</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>

      {rowsForTable.length > 0 && (
        <Section
          title={s ? "플레이북 조항과 기존 계약 현황" : "공통 기준 항목과 기존 계약 현황"}
          desc={reviewed ? `보관함 계약 ${reviewed}건을 검토한 결과입니다. 자주 다른 조항은 표준 문구 협상 가이드나 플레이북 보완 후보입니다.` : "아직 이 유형의 계약이 없습니다."}
        >
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-normal">조항</th>
                  {s && <th className="px-4 py-2.5 font-normal">등급</th>}
                  <th className="px-4 py-2.5 text-right font-normal">수정 필요</th>
                  <th className="px-4 py-2.5 text-right font-normal">변호사 확인</th>
                  <th className="px-4 py-2.5 text-right font-normal">표준과 다른 비율</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rowsForTable.map((r) => (
                  <tr key={r.title}>
                    <td className="px-4 py-2.5">{r.title}</td>
                    {s && <td className={`px-4 py-2.5 text-xs font-medium ${GRADE[r.grade ?? "none"]?.cls ?? ""}`}>{GRADE[r.grade ?? "none"]?.label || "–"}</td>}
                    <td className={`px-4 py-2.5 text-right tabular-nums ${r.st?.risk ? "text-redline" : "text-slate"}`}>{r.st ? r.st.risk : "–"}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${r.st?.lawyer ? "text-caution" : "text-slate"}`}>{r.st ? r.st.lawyer : "–"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.st && r.st.reviewed ? `${pct(r.st.risk + r.st.lawyer, r.st.reviewed)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Section>
      )}

      {s && s.checklist.length > 0 && (
        <Section title="필수 체크리스트" desc="플레이북 3절">
          <Panel className="p-5">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              {s.checklist.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </Panel>
        </Section>
      )}

      {s && (
        <details className="rounded-lg border border-line bg-white px-5 py-4">
          <summary className="cursor-pointer text-sm">표준계약서 원문 보기 ({s.title})</summary>
          <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto text-[0.95rem] leading-relaxed">
            {s.paragraphs.map((p) => (
              <p key={p.id} className={/^(제\s?\d+\s?조|ARTICLE|Article)/.test(p.text) ? "pt-2 font-semibold" : "text-ink-soft"}>
                {p.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
