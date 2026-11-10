import Link from "next/link";
import { Panel, Pill, pct } from "@/components/ui";
import { standardsOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  const rows = await standardsOverview();
  const std = rows.filter((r) => r.hasStandard);
  const groups = [...new Set(std.map((r) => r.group ?? "기타"))];
  const noStd = rows.filter((r) => !r.hasStandard && (r.n > 0 || r.status === "new") && r.key !== "non_contract");

  return (
    <div className="space-y-10">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">표준계약서</h1>
        <p className="mt-2 leading-relaxed text-ink-soft">
          어댑트 법무팀이 정한 표준 {std.length}종과 플레이북입니다. 검토 요청은 유형에 맞는 플레이북으로 조항별 검토되고, 표준과 다른 부분은 이 표준 원본 위에 변경 내용으로 표시됩니다.
        </p>
      </div>

      <section className="space-y-6">
        {groups.map((g) => (
          <div key={g}>
            <h2 className="mb-2 text-sm font-semibold text-slate">{g}</h2>
            <Panel>
              <ul className="divide-y divide-line">
                {std
                  .filter((r) => (r.group ?? "기타") === g)
                  .map((r) => (
                    <li key={r.key}>
                      <Link href={`/standards/${r.key}`} className="grid gap-1 px-4 py-3 hover:bg-paper sm:grid-cols-[1fr_10rem_12rem] sm:items-center">
                        <span className="min-w-0">
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 text-xs text-slate">{r.standardId}</span>
                        </span>
                        <span className="text-sm text-slate sm:text-right">보관함 {r.n}건</span>
                        <span className="text-sm sm:text-right">
                          {r.reviewed > 0 ? (
                            <>
                              수정 필요 계약 <b className="font-semibold">{pct(r.deviating, r.reviewed)}%</b>
                            </>
                          ) : (
                            <span className="text-slate">아직 계약 없음</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Panel>
          </div>
        ))}
      </section>

      {noStd.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">표준이 없는 유형</h2>
          <p className="mt-1 text-sm text-slate">어댑트 표준이 아직 없어 공통 기준으로 검토한 유형입니다. 계약이 많을수록 표준 제정이 급합니다. 검토 요청에서 새로 등록한 유형도 여기에 나옵니다.</p>
          <Panel className="mt-3">
            <ul className="divide-y divide-line">
              {noStd
                .sort((a, b) => b.n - a.n)
                .map((r) => (
                  <li key={r.key}>
                    <Link href={`/standards/${r.key}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.status === "new" ? <Pill cls="bg-insert-tint text-insert">새로 등록</Pill> : <Pill cls="bg-caution-tint text-caution">표준 제정 필요</Pill>}
                      </span>
                      <span className="text-sm text-slate">
                        보관함 {r.n}건{r.estimate ? ` · 어댑트 추정 전체 ${r.estimate.toLocaleString()}건` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Panel>
        </section>
      )}
    </div>
  );
}
