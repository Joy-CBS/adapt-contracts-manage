import Link from "next/link";
import { LawyerBulkRequest, LawyerItemActions } from "@/components/lawyer-actions";
import { Crumbs, Empty, GRADE, Panel } from "@/components/ui";
import { type LawyerItem, lawyerItems } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "요청 전" },
  { key: "requested", label: "답변 대기" },
  { key: "answered", label: "답변 완료" },
] as const;

type Tab = (typeof TABS)[number]["key"];

function questionsText(rows: LawyerItem[]) {
  const head = `[계약 검토 요청] ${rows[0].counterparty || rows[0].filename} (${rows[0].categoryName ?? ""})`;
  return [head, ...rows.map((r, i) => `${i + 1}. ${r.item.clause_ref}: ${r.item.lawyer_question}${r.item.contract_excerpt ? `\n   계약서 문구: "${r.item.contract_excerpt.slice(0, 200)}"` : ""}`)].join("\n");
}

export default async function LawyerPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === raw)?.key ?? "open") as Tab;
  const [items, all] = await Promise.all([lawyerItems(tab), lawyerItems()]);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, all.filter((x) => x.status === t.key).length]));
  const byContract = new Map<string, LawyerItem[]>();
  for (const it of items) byContract.set(it.reviewId, [...(byContract.get(it.reviewId) ?? []), it]);

  return (
    <div>
      <Crumbs items={[{ href: "/", label: "할 일" }, { label: "변호사 확인" }]} />
      <h1 className="text-2xl font-semibold tracking-tight">변호사 확인</h1>
      <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-slate">
        AI가 결론을 내리지 않은 항목입니다. 플레이북 알림 규칙(레드플래그)에 해당하거나, 필수 조항이 표준과 다르거나, 확정 기준이 없는 경우입니다. 질문 목록을 복사해 변호사에게 보내고
        요청으로 표시한 뒤, 답변이 오면 기록하세요.
      </p>

      <nav className="mt-6 flex gap-1 border-b border-line text-sm" aria-label="진행 상태">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/lawyer?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${tab === t.key ? "border-ink font-medium" : "border-transparent text-slate hover:text-ink"}`}
          >
            {t.label} <span className="tabular-nums text-slate">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="mt-6">
          <Empty>{tab === "open" ? "요청할 항목이 없습니다." : tab === "requested" ? "답변을 기다리는 항목이 없습니다." : "아직 기록된 답변이 없습니다."}</Empty>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {[...byContract.values()].map((rows) => {
            const first = rows[0];
            return (
              <Panel key={first.reviewId}>
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <Link href={`/contracts/${first.contractId}`} className="font-semibold hover:underline">
                      {first.counterparty || first.filename}
                    </Link>
                    <div className="text-xs text-slate">
                      {first.categoryName} · {rows.length}개 항목
                    </div>
                  </div>
                  {tab === "open" && <LawyerBulkRequest reviewId={first.reviewId} indexes={rows.map((r) => r.itemIndex)} questions={questionsText(rows)} />}
                </header>
                <ul className="divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.itemIndex} className="space-y-2 px-5 py-4">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`text-xs font-medium ${GRADE[r.item.severity]?.cls ?? ""}`}>{GRADE[r.item.severity]?.label}</span>
                        <h3 className="font-medium">{r.item.clause_ref}</h3>
                      </div>
                      <p className="text-sm leading-relaxed">
                        <span className="mr-1 text-caution">Q.</span>
                        {r.item.lawyer_question}
                      </p>
                      {r.item.contract_excerpt && (
                        <p className="border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-soft">{r.item.contract_excerpt}</p>
                      )}
                      <p className="text-xs text-slate">AI가 결론을 내리지 않은 이유: {r.item.why}</p>
                      <LawyerItemActions
                        reviewId={r.reviewId}
                        itemIndex={r.itemIndex}
                        state={{ status: r.status, resolution: r.resolution, answerNote: r.answerNote, requestNote: r.requestNote }}
                      />
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
