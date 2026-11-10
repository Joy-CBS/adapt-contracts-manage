import Link from "next/link";
import { ApproveStrongButton, ClassifyActions } from "@/components/classify-actions";
import { EvidenceButton } from "@/components/evidence";
import { Crumbs, Empty, LEVEL, LevelPill, Panel } from "@/components/ui";
import type { Classification } from "@/lib/review-types";
import { categoryOptions, classifyQueue, subtypeNames } from "@/lib/queries";

export const dynamic = "force-dynamic";

const ORDER = ["weak", "medium", "strong"] as const;
const HINT: Record<string, string> = {
  weak: "판단이 엇갈리거나 다른 유형일 가능성이 있는 건입니다. i 버튼으로 근거를 보고, 필요하면 계약서를 열어 확인하세요.",
  medium: "두 판단은 같지만 근거 신호가 적은 건입니다. 근거를 훑어보고 승인하세요.",
  strong: "두 판단이 같고 분류 기준 신호가 충분한 건입니다. 한 번에 승인해도 됩니다.",
};

export default async function ClassifyPage() {
  const [rows, options, subNames] = await Promise.all([classifyQueue(), categoryOptions(), subtypeNames()]);
  const names: Record<string, string> = { ...Object.fromEntries(subNames), ...Object.fromEntries(options.map((o) => [o.key, o.name])) };
  const groups = ORDER.map((lv) => ({ lv, rows: rows.filter((r) => (r.level ?? "weak") === lv) }));
  const strong = groups.find((g) => g.lv === "strong")!.rows.length;

  return (
    <div>
      <Crumbs items={[{ href: "/", label: "할 일" }, { label: "분류 확인" }]} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI 분류 확인 · {rows.length}건</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-slate">
            Studio(solar-pro4)가 어댑트 분류체계로 나눈 유형입니다. 이 모델은 신뢰도 점수를 주지 않아, Studio 분류와 근거 분석이 같은지와 계약서에서 확인한 분류 신호로
            <b className="font-medium text-ink-soft"> 근거 수준</b>을 매겼습니다. 상위 5개 유형이 아니면 기타로 묶여 공통 기준까지 검토합니다.
          </p>
        </div>
        <ApproveStrongButton count={strong} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-8">
          <Empty>
            승인 대기 중인 분류가 없습니다.{" "}
            <Link href="/lawyer" className="text-insert hover:underline">
              다음 단계: 변호사 확인 요청
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groups
            .filter((g) => g.rows.length)
            .map((g) => (
              <section key={g.lv} aria-labelledby={`lv-${g.lv}`}>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id={`lv-${g.lv}`} className="text-lg font-semibold">
                    {LEVEL[g.lv].label} <span className="font-normal text-slate">{g.rows.length}건</span>
                  </h2>
                  <p className="text-sm text-slate">{HINT[g.lv]}</p>
                </div>
                <Panel>
                  <ul className="divide-y divide-line">
                    {g.rows.map((r) => {
                      const c = r.classification as Classification | null;
                      const sub = c?.subtypeId && r.categoryKey === "others" ? names[c.subtypeId] : null;
                      return (
                        <li key={r.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                          <div className="min-w-0">
                            <Link href={`/contracts/${r.id}`} className="block truncate font-medium hover:underline">
                              {r.counterparty || r.title || r.filename}
                            </Link>
                            <div className="truncate text-xs text-slate">{r.filename}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                              <span className="text-slate">AI 분류</span>
                              <span className="font-medium">{r.categoryName}</span>
                              {sub && <span className="text-xs text-slate">· 세부 {sub}</span>}
                              <LevelPill level={c?.level} />
                              <EvidenceButton c={c} names={names} />
                            </div>
                          </div>
                          <ClassifyActions contractId={r.id} current={r.categoryKey} options={options} state="suggested" compact />
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
