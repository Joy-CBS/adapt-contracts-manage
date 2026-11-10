import { LawyerItemActions } from "@/components/lawyer-actions";
import { DECISION, GRADE, Pill } from "@/components/ui";
import type { ReviewItem } from "@/lib/review-types";

const FINDING: Record<string, string> = { 일탈: "표준과 다름", 누락: "계약서에 없음", 추가조항: "상대방이 추가한 조항", 일치: "표준과 같음", "해당 없음": "적용 대상 아님" };

export type ItemState = { status: "open" | "requested" | "answered"; resolution?: string | null; answerNote?: string | null; requestNote?: string | null };

function ItemCard({ x, index, reviewId, state, actions }: { x: ReviewItem; index: number; reviewId: string; state?: ItemState; actions: boolean }) {
  const d = DECISION[x.decision];
  return (
    <article id={`item-${index}`} className={`scroll-mt-20 rounded-lg border border-l-4 border-line bg-white ${d.border}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <h3 className="font-semibold">{x.clause_ref}</h3>
        {x.severity !== "none" && <span className={`text-xs font-medium ${GRADE[x.severity].cls}`}>{GRADE[x.severity].label}</span>}
        <span className="text-xs text-slate">{FINDING[x.finding] ?? x.finding}</span>
        {state?.status === "requested" && <Pill cls="bg-caution-tint text-caution">답변 대기</Pill>}
        {state?.status === "answered" && <Pill cls="bg-comply-tint text-comply">변호사: {state.resolution}</Pill>}
      </header>
      {x.issue && <p className="px-5 pt-2 text-[0.95rem] leading-relaxed">{x.issue}</p>}
      {x.decision === "needs_lawyer" && x.lawyer_question && (
        <p className="mx-5 mt-3 rounded-md bg-caution-tint/60 px-3 py-2 text-sm leading-relaxed">
          <b className="mr-1 font-semibold text-caution">변호사에게 물을 것</b>
          {x.lawyer_question}
        </p>
      )}
      {(x.contract_excerpt || x.suggestion || x.suggestion_ko) && (
        <div className="mt-3 space-y-2.5 border-t border-line px-5 py-4 text-[0.95rem] leading-[1.8]">
          {x.contract_excerpt && (
            <div>
              <div className="mb-0.5 text-xs text-slate">계약서 문구</div>
              <p className="whitespace-pre-line">
                <span className={x.decision === "risk" ? "redline-del" : ""}>{x.contract_excerpt}</span>
              </p>
            </div>
          )}
          {(x.suggestion || x.suggestion_ko) && (
            <div>
              <div className="mb-0.5 text-xs text-slate">수정 제안</div>
              <p className="whitespace-pre-line">
                <span className="redline-ins">{x.suggestion || x.suggestion_ko}</span>
              </p>
              {x.suggestion && x.suggestion_ko && x.suggestion_ko !== x.suggestion && <p className="mt-1 text-sm text-slate">국문: {x.suggestion_ko}</p>}
            </div>
          )}
        </div>
      )}
      <footer className="space-y-3 border-t border-line bg-paper/60 px-5 py-3">
        <p className="text-xs leading-relaxed text-slate">
          <b className="font-medium text-ink-soft">AI 판단 이유</b> {x.why}
          {x.basis ? (
            <>
              {" "}
              · 근거 {x.basis_tag && x.basis_tag !== "없음" ? <b className="font-medium">{x.basis_tag}</b> : null} {x.basis}
            </>
          ) : null}
        </p>
        {actions && x.decision === "needs_lawyer" && state?.status !== "open" && state && <LawyerItemActions reviewId={reviewId} itemIndex={index} state={state} />}
      </footer>
    </article>
  );
}

const GROUPS = [
  { key: "risk", title: "수정 필요", desc: "법무팀이 확정한 기준을 벗어난 조항입니다. 표준양식 Word 파일에 변경 내용과 수정 제안이 표시됩니다." },
  { key: "needs_lawyer", title: "변호사 확인", desc: "AI가 결론을 내리지 않은 항목입니다. 알림 규칙 해당, 필수 조항 차이, 확정 기준이 없는 경우입니다." },
  { key: "note", title: "참고", desc: "결론이 필요 없는 형식 차이·추가 권고·적용 대상 아님." },
] as const;

/** 검토 항목: 결론별로 묶어 보여준다. actions=true면 변호사 답변 기록 버튼 표시 */
export function ReviewItems({
  items,
  reviewId,
  states,
  actions = false,
}: {
  items: ReviewItem[];
  reviewId: string;
  states: Map<number, ItemState>;
  actions?: boolean;
}) {
  const all = items.map((x, i) => ({ x, i }));
  const ok = all.filter((y) => y.x.decision === "ok");
  return (
    <div className="space-y-10">
      {GROUPS.map((g) => {
        const list = all.filter((y) => y.x.decision === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="space-y-3" aria-labelledby={`g-${g.key}`}>
            <div>
              <h2 id={`g-${g.key}`} className="text-lg font-semibold tracking-tight">
                {g.title} <span className="font-normal text-slate">{list.length}</span>
              </h2>
              <p className="text-sm text-slate">{g.desc}</p>
            </div>
            {list.map((y) => (
              <ItemCard key={y.i} x={y.x} index={y.i} reviewId={reviewId} state={states.get(y.i) ?? (y.x.decision === "needs_lawyer" ? { status: "open" } : undefined)} actions={actions} />
            ))}
          </section>
        );
      })}
      {ok.length > 0 && (
        <details className="rounded-lg border border-line bg-white px-5 py-4 text-sm">
          <summary className="cursor-pointer">
            기준을 충족하는 항목 <b className="font-medium text-comply">{ok.length}개</b>
          </summary>
          <ul className="mt-3 space-y-1.5 text-ink-soft">
            {ok.map((y) => (
              <li key={y.i}>{y.x.clause_ref}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
