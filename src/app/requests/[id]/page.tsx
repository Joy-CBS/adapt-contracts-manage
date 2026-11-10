import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh, Stepper } from "@/components/flow";
import { CompleteButton, LawyerHandoff } from "@/components/request-actions";
import { type ItemState, ReviewItems } from "@/components/review-items";
import { TypeConfirm } from "@/components/type-confirm";
import { Crumbs, LANG, Panel, formatAmount } from "@/components/ui";
import { categoryOptions, getContract } from "@/lib/queries";
import { nextAction } from "@/lib/request-status";
import { studioReady, syncRequest } from "@/lib/requests";

export const dynamic = "force-dynamic";

const FACTS: Array<[string, string]> = [
  ["contract_title", "계약명"],
  ["counterparty_name", "상대방"],
  ["adapt_entity", "어댑트 측"],
  ["signed_date", "체결일"],
  ["term", "계약 기간"],
  ["payment_terms", "지급 조건"],
  ["territory", "지역"],
];

function Waiting({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-insert border-t-transparent" aria-hidden />
      <div>
        <p className="text-lg font-semibold">{title}</p>
        <p className="mt-1 text-sm text-ink-soft">{hint} 이 화면은 자동으로 새로고침됩니다. 다른 일을 하셔도 괜찮아요.</p>
      </div>
    </div>
  );
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (studioReady()) await syncRequest(id).catch(() => null);
  const [data, options] = await Promise.all([getContract(id), categoryOptions()]);
  if (!data || !data.contract.stage) notFound();
  const { contract: c, category, review, standard, states } = data;
  const m = c.metadata;
  const items = review?.result.items ?? [];
  const st = (i: number) => states.get(i)?.status ?? "open";
  const lawyerIdx = items.map((x, i) => ({ x, i })).filter((y) => y.x.decision === "needs_lawyer");
  const open = lawyerIdx.filter((y) => st(y.i) === "open");
  const requested = lawyerIdx.filter((y) => st(y.i) === "requested");
  const answered = lawyerIdx.filter((y) => st(y.i) === "answered");
  const risk = items.filter((x) => x.decision === "risk").length;
  const a = nextAction({ stage: c.stage, lawyerOpen: open.length, lawyerRequested: requested.length });
  const name = String(m.counterparty_name || m.contract_title || c.filename);
  const stateMap = new Map<number, ItemState>([...states].map(([k, v]) => [k, { status: v.status, resolution: v.resolution, answerNote: v.answerNote, requestNote: v.requestNote }]));
  const questions = [`[계약 검토 요청] ${name} · ${category?.name ?? ""}`, `파일: ${c.filename}`, "", ...open.map((y, k) => `${k + 1}. ${y.x.clause_ref}\n   질문: ${y.x.lawyer_question}${y.x.contract_excerpt ? `\n   계약서 문구: "${y.x.contract_excerpt.slice(0, 240)}"` : ""}`)].join("\n");

  return (
    <div>
      {(c.stage === "analyzing" || c.stage === "reviewing") && <AutoRefresh />}
      <Crumbs items={[{ href: "/", label: "검토 요청" }, { label: name }]} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
          <p className="mt-1 break-all text-sm text-slate">
            {c.filename}
            {category ? ` · ${category.name}` : ""}
          </p>
        </div>
        <Stepper step={a.step} done={a.owner === "done"} />
      </div>

      {/* 지금 할 일 */}
      <section
        aria-label="지금 할 일"
        className={`mt-6 rounded-xl border-2 p-5 sm:p-6 ${a.owner === "mine" ? "border-ink bg-white" : a.owner === "done" ? "border-comply/40 bg-comply-tint/30" : "border-line bg-white"}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate">{a.owner === "mine" ? "지금 할 일" : a.owner === "done" ? "완료" : "진행 상황"}</p>

        {c.stage === "analyzing" && <Waiting title="AI가 계약서를 읽고 유형을 판단하고 있어요" hint="Studio(solar-pro4)가 정보 추출과 유형 판단을 합니다. 보통 1분 안팎." />}

        {c.stage === "type_check" && (
          <div className="mt-3">
            <TypeConfirm contractId={c.id} c={c.classification} options={options} />
          </div>
        )}

        {c.stage === "reviewing" && (
          <Waiting
            title={`${category?.name ?? ""} 기준으로 리스크를 검토하고 있어요`}
            hint={category?.hasStandard ? `어댑트 플레이북 ${category.standardId}의 조항을 하나씩 대조합니다. 보통 1~2분.` : "전 표준 공통 기준으로 대조합니다. 보통 1~2분."}
          />
        )}

        {c.stage === "failed" && (
          <p className="mt-2 text-redline">
            처리하지 못했습니다: {c.error ?? "알 수 없는 오류"}.{" "}
            <Link href="/requests/new" className="underline">
              다시 올리기
            </Link>
          </p>
        )}

        {(c.stage === "reviewed" || c.stage === "done") && review && (
          <div className="mt-2 space-y-5">
            <p className="text-lg font-semibold leading-snug">
              {risk > 0 ? `수정이 필요한 조항 ${risk}개` : "확정 기준을 벗어난 조항은 없어요"}
              {lawyerIdx.length > 0 ? ` · 변호사 확인 ${lawyerIdx.length}개` : ""}
            </p>
            {review.result.overall_opinion && <p className="max-w-[75ch] text-sm leading-relaxed text-ink-soft">{review.result.overall_opinion}</p>}

            {c.stage === "reviewed" && open.length > 0 && (
              <div className="rounded-lg bg-caution-tint/50 p-4">
                <p className="font-semibold">변호사에게 확인받을 항목이 {open.length}개 있어요</p>
                <p className="mb-3 mt-0.5 text-sm text-ink-soft">AI가 결론을 내리지 않은 항목입니다. 아래 &lsquo;변호사 확인&rsquo;에서 질문을 미리 볼 수 있어요.</p>
                <LawyerHandoff reviewId={review.id} indexes={open.map((y) => y.i)} questions={questions} />
              </div>
            )}
            {c.stage === "reviewed" && open.length === 0 && requested.length > 0 && (
              <div className="rounded-lg bg-paper p-4 text-sm">
                <p className="font-semibold">변호사 답변을 기다리고 있어요 · {requested.length}개 항목</p>
                <p className="mt-0.5 text-ink-soft">답변이 오면 아래 &lsquo;변호사 확인&rsquo; 항목마다 &lsquo;변호사 답변 기록&rsquo;을 눌러 남기세요. 모두 기록하면 완료할 수 있어요.</p>
                <a href={`#item-${requested[0].i}`} className="mt-2 inline-block font-medium text-insert hover:underline">
                  첫 항목으로 가기 ↓
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <a href={`/api/contracts/${c.id}/redline`} className="inline-flex items-center rounded-md border border-ink/20 bg-white px-4 py-2.5 font-medium hover:bg-paper">
                {standard ? "표준양식 수정본(.docx) 받기" : "검토 의견서(.docx) 받기"}
              </a>
              <span className="text-xs text-slate">
                {standard ? `어댑트 표준 ${standard.standardId} 원본에 상대방 문구와 차이를 변경 추적으로, 판단 근거를 메모로 표시` : "표준이 없는 유형이라 항목별 검토 의견을 Word로 정리"}
              </span>
              {c.stage === "reviewed" && open.length === 0 && requested.length === 0 && (
                <span className="ml-auto">
                  <CompleteButton contractId={c.id} done={false} />
                </span>
              )}
              {c.stage === "done" && (
                <span className="ml-auto">
                  <CompleteButton contractId={c.id} done />
                </span>
              )}
            </div>
            {answered.length > 0 && <p className="text-xs text-slate">변호사 답변 기록 {answered.length}/{lawyerIdx.length}개</p>}
          </div>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          {review ? (
            <ReviewItems items={items} reviewId={review.id} states={stateMap} actions />
          ) : (
            <p className="text-sm text-slate">리스크 검토 결과는 유형을 확인한 뒤에 나옵니다.</p>
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Panel className="p-5 text-sm">
            <h2 className="font-semibold">계약 정보</h2>
            <p className="mt-1 text-xs text-slate">AI(solar-pro4)가 계약서에서 읽은 값</p>
            <dl className="mt-3 space-y-2.5">
              {FACTS.map(([k, label]) => {
                const v = m[k];
                const s = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                if (!s) return null;
                return (
                  <div key={k}>
                    <dt className="text-xs text-slate">{label}</dt>
                    <dd className="mt-0.5 leading-relaxed">{s}</dd>
                  </div>
                );
              })}
              {m.amount ? (
                <div>
                  <dt className="text-xs text-slate">금액</dt>
                  <dd className="mt-0.5">{formatAmount(m.amount, m.currency)}</dd>
                </div>
              ) : null}
              {c.language && (
                <div>
                  <dt className="text-xs text-slate">언어</dt>
                  <dd className="mt-0.5">{LANG[c.language] ?? c.language}</dd>
                </div>
              )}
            </dl>
          </Panel>
          {c.requestNote && (
            <Panel className="p-5 text-sm">
              <h2 className="font-semibold">요청 메모</h2>
              <p className="mt-2 whitespace-pre-line text-ink-soft">{c.requestNote}</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
