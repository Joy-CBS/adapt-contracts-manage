import Link from "next/link";
import { Meter, Panel, RiskBar, Section, VerdictPill, pct } from "@/components/ui";
import { clauseStats, listCategories, listContracts, overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [o, cats, stats, queue] = await Promise.all([overview(), listCategories(), clauseStats(), listContracts()]);
  const total = Math.max(o.contracts, 1);
  const top3 = cats.slice(0, 3).reduce((a, c) => a + c.count, 0);
  const smallCats = cats.filter((c) => c.count <= 3);
  const confirmed = cats.filter((c) => c.templateStatus === "confirmed").length;
  // 표준화 우선순위: 많이 쓰이고 리스크가 큰 유형부터
  const priority = [...cats].sort((a, b) => b.count * (1 + b.avgHigh) - a.count * (1 + a.avgHigh));
  const hotspots = [...stats]
    .filter((s) => s.reviewed >= 5)
    .sort((a, b) => b.high - a.high || b.high / b.reviewed - a.high / a.reviewed)
    .slice(0, 6);

  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-[2.5rem]">
            계약서 {o.contracts}건을 표준계약서 {cats.length}종으로 정리할 수 있습니다
          </h1>
          <p className="mt-4 max-w-[60ch] text-ink-soft">
            상위 3개 유형이 전체의 <b className="font-semibold text-ink">{pct(top3, total)}%</b>를 차지합니다. 이 세 가지 표준계약서만 확정해도 대부분의
            계약을 표준 양식으로 관리할 수 있습니다.{" "}
            {smallCats.length > 0 && `나머지 ${smallCats.length}개 유형은 3건 이하로, 개별 검토가 효율적일 수 있습니다.`}
          </p>
        </div>
        <Panel className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm text-slate">표준안 확정</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
                {confirmed}
                <span className="text-base font-normal text-slate"> / {cats.length}종</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate">수정이 필요한 계약</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-redline">
                {pct(o.red, o.reviewed)}%<span className="text-base font-normal text-slate"> · {o.red}건</span>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-sm text-slate">계약서 1건당 고위험 조항</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums">평균 {o.avgHigh.toFixed(1)}개</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-slate">
            비교 기준인 표준안은 기존 계약서로 만든 초안입니다. 어댑트 표준계약서로 교체하면 판정이 더 정확해집니다.
          </p>
        </Panel>
      </section>

      <Section title="표준계약서 확정 순서" desc="많이 쓰이고 리스크가 큰 유형부터 확정하면 효과가 큽니다.">
        <Panel>
          <ol className="divide-y divide-line">
            {priority.slice(0, 6).map((c, i) => (
              <li key={c.id}>
                <Link href={`/categories/${c.classKey}`} className="grid grid-cols-[2rem_1fr] items-center gap-x-3 gap-y-2 px-4 py-3.5 hover:bg-paper md:grid-cols-[2rem_1fr_10rem_9rem_6rem]">
                  <span className="text-sm tabular-nums text-slate">{i + 1}</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="col-start-2 flex items-center gap-2 md:col-start-auto">
                    <Meter value={c.count} max={cats[0]?.count ?? 1} />
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums">{c.count}건</span>
                  </span>
                  <span className="col-start-2 text-sm text-slate md:col-start-auto">
                    고위험 조항 평균 <b className="font-medium text-redline">{c.avgHigh.toFixed(1)}</b>개
                  </span>
                  <span className="col-start-2 md:col-start-auto md:text-right">
                    {c.templateStatus === "confirmed" ? (
                      <span className="text-xs text-comply">확정됨</span>
                    ) : (
                      <span className="text-xs text-slate">초안</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="자주 벗어나는 조항" desc="고위험으로 판정된 계약이 많은 조항입니다. 플레이북에 먼저 반영할 후보입니다.">
          <Panel>
            <ul className="divide-y divide-line">
              {hotspots.map((h) => (
                <li key={`${h.classKey}-${h.no}`}>
                  <Link href={`/categories/${h.classKey}#clause-${h.no}`} className="block px-4 py-3 hover:bg-paper">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{h.title.replace(/^제\d+조\s*/, "")}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-redline">{pct(h.high, h.reviewed)}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate">
                      <span className="truncate">{h.categoryName}</span>
                      <span className="shrink-0">
                        {h.reviewed}건 중 {h.high}건 고위험{h.missing ? ` · 조항 없음 ${h.missing}건` : ""}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>

        <Section
          title="먼저 검토할 계약서"
          desc="고위험 조항이 많은 순서입니다."
          action={
            <Link href="/contracts" className="text-sm text-insert hover:underline">
              전체 {o.contracts}건 보기
            </Link>
          }
        >
          <Panel>
            <ul className="divide-y divide-line">
              {queue.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link href={`/contracts/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.counterparty || r.title || r.filename}</div>
                      <div className="truncate text-xs text-slate">{r.categoryName}</div>
                    </div>
                    <RiskBar high={r.high} medium={r.medium} low={r.low} />
                    <VerdictPill verdict={r.verdict} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>
      </div>
    </div>
  );
}
