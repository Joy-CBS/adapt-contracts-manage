import Link from "next/link";
import { Empty, Meter, Panel, Pill, pct } from "@/components/ui";
import { listCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const cats = await listCategories();
  const total = cats.reduce((a, c) => a + c.count, 0);
  const max = Math.max(...cats.map((c) => c.count), 1);

  return (
    <div className="space-y-10">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">표준계약서와 검토 범위</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">
          어댑트 전달자료(분류체계 49종·플레이북 25종) 기준입니다. 계약 수가 많은 상위 5개 유형은 해당 플레이북으로 조항별로 검토하고, 나머지는 모두
          기타로 묶어 전 표준 공통 기준(01_COMMON_POSITIONS)까지 검토합니다.
        </p>
      </div>

      {cats.length === 0 ? (
        <Empty>아직 유형이 없습니다. 데이터 적재 화면에서 분석 결과를 올려 주세요.</Empty>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {cats.map((c, i) => (
              <li key={c.id}>
                <Link href={`/categories/${c.classKey}`} className="grid gap-3 px-4 py-4 hover:bg-paper md:grid-cols-[2rem_1fr_12rem_11rem] md:items-center">
                  <span className="hidden text-sm tabular-nums text-slate md:block">{c.classKey === "others" ? "–" : i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.hasStandard ? (
                        <Pill cls="bg-comply-tint text-comply">어댑트 표준 {c.standardId}</Pill>
                      ) : c.classKey === "others" ? (
                        <Pill>공통 기준 검토</Pill>
                      ) : (
                        <Pill cls="bg-caution-tint text-caution">표준 없음 · 제정 필요</Pill>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 max-w-[72ch] text-sm text-slate">{c.definition}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Meter value={c.count} max={max} />
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                      {c.count}건 <span className="text-slate">{pct(c.count, total)}%</span>
                    </span>
                  </div>
                  <div className="text-sm text-slate md:text-right">
                    {c.estimate ? `어댑트 추정 전체 ${c.estimate.toLocaleString()}건` : "상위 5종 외 전부"}
                    <div className="text-xs">
                      수정 필요 <b className="font-medium text-redline">{c.red}</b> · 변호사 확인 <b className="font-medium text-caution">{c.yellow}</b>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
