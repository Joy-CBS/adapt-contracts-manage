import Link from "next/link";
import { Empty, Meter, Panel, Pill, pct } from "@/components/ui";
import { listCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const cats = await listCategories();
  const total = cats.reduce((a, c) => a + c.count, 0);
  const major = cats.filter((c) => c.count > 3);
  const minor = cats.filter((c) => c.count <= 3);

  const Row = ({ c }: { c: (typeof cats)[number] }) => (
    <li>
      <Link href={`/categories/${c.classKey}`} className="grid gap-3 px-4 py-4 hover:bg-paper md:grid-cols-[1fr_11rem_10rem_8rem] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.name}</span>
            {!c.standardizable && <Pill cls="bg-caution-tint text-caution">정형화 어려움</Pill>}
            {c.origin === "new" && <Pill cls="bg-insert-tint text-insert">신규 유형</Pill>}
          </div>
          <p className="mt-1 line-clamp-2 max-w-[70ch] text-sm text-slate">{c.definition}</p>
        </div>
        <div className="flex items-center gap-2">
          <Meter value={c.count} max={cats[0]?.count ?? 1} />
          <span className="w-20 shrink-0 text-right text-sm tabular-nums">
            {c.count}건 <span className="text-slate">{pct(c.count, total)}%</span>
          </span>
        </div>
        <div className="text-sm text-slate">
          고위험 조항 평균 <b className="font-medium text-redline">{c.avgHigh.toFixed(1)}</b>개
        </div>
        <div className="text-sm md:text-right">
          {c.templateStatus === "confirmed" ? (
            <span className="text-comply">표준안 확정</span>
          ) : c.templateStatus ? (
            <span className="text-slate">초안 {c.clauseCount}개 조항</span>
          ) : (
            <span className="text-slate">표준안 없음</span>
          )}
        </div>
      </Link>
    </li>
  );

  return (
    <div className="space-y-10">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">표준계약서</h1>
        <p className="mt-3 text-ink-soft">
          기존 계약서를 같은 양식으로 관리할 수 있는 단위로 묶은 {cats.length}개 유형입니다. 각 유형의 표준안은 계약서들의 공통 조항과 편차로 만든
          초안이며, 법무팀이 확정하거나 어댑트 표준계약서로 교체합니다.
        </p>
      </div>

      {cats.length === 0 ? (
        <Empty>아직 유형이 없습니다. 데이터 적재 화면에서 분석 결과를 올려 주세요.</Empty>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">주요 유형 ({major.length}종)</h2>
            <Panel>
              <ul className="divide-y divide-line">
                {major.map((c) => (
                  <Row key={c.id} c={c} />
                ))}
              </ul>
            </Panel>
          </section>
          {minor.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">소수 유형 ({minor.length}종)</h2>
                <p className="mt-1 text-sm text-slate">3건 이하로 쓰인 유형입니다. 표준계약서로 만들지, 건별로 검토할지 정합니다.</p>
              </div>
              <Panel>
                <ul className="divide-y divide-line">
                  {minor.map((c) => (
                    <Row key={c.id} c={c} />
                  ))}
                </ul>
              </Panel>
            </section>
          )}
        </>
      )}
    </div>
  );
}
