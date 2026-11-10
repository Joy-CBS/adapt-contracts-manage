import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassifyActions } from "@/components/classify-actions";
import { EvidenceButton } from "@/components/evidence";
import { LawyerBulkRequest, LawyerItemActions } from "@/components/lawyer-actions";
import { CLASSIFY_STATE, Crumbs, DECISION, GRADE, LANG, LevelPill, Panel, Pill, VerdictPill, formatAmount } from "@/components/ui";
import type { ReviewItem } from "@/lib/review-types";
import { categoryOptions, getContract, subtypeNames } from "@/lib/queries";
import { studioAvailable, syncReReview } from "@/lib/rereview";
import { retryReReview } from "@/app/actions";

export const dynamic = "force-dynamic";

const FACTS: Array<[string, string]> = [
  ["counterparty_type", "상대방 유형"],
  ["adapt_entity", "어댑트 측"],
  ["brands", "브랜드"],
  ["channels", "채널"],
  ["territory", "지역"],
  ["term", "계약 기간"],
  ["secondary_use_period", "2차 활용"],
  ["payment_terms", "지급 조건"],
];

const FINDING: Record<string, string> = { 일탈: "표준과 다름", 누락: "계약서에 없음", 추가조항: "상대방이 추가한 조항", 일치: "표준과 같음", "해당 없음": "적용 대상 아님" };

type ItemState = { status: "open" | "requested" | "answered"; resolution?: string | null; answerNote?: string | null; requestNote?: string | null };

function ItemCard({ x, index, reviewId, state }: { x: ReviewItem; index: number; reviewId: string; state?: ItemState }) {
  const d = DECISION[x.decision];
  return (
    <article className={`rounded-lg border border-l-4 border-line bg-white ${d.border}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <h3 className="font-semibold">{x.clause_ref}</h3>
        <Pill cls={d.cls}>{d.label}</Pill>
        {x.severity !== "none" && <span className={`text-xs font-medium ${GRADE[x.severity].cls}`}>{GRADE[x.severity].label} 조항</span>}
        <span className="text-xs text-slate">{FINDING[x.finding] ?? x.finding}</span>
      </header>
      {x.issue && <p className="px-5 pt-2 text-sm leading-relaxed text-ink-soft">{x.issue}</p>}
      {x.basis && (
        <p className="px-5 pt-1.5 text-xs leading-relaxed text-slate">
          근거 {x.basis_tag && x.basis_tag !== "없음" ? <b className="font-medium text-ink-soft">{x.basis_tag}</b> : null} {x.basis}
        </p>
      )}
      {(x.contract_excerpt || x.suggestion) && (
        <div className="mt-3 space-y-3 border-t border-line px-5 py-4 text-[0.95rem] leading-[1.85]">
          {x.contract_excerpt ? (
            <p className="whitespace-pre-line">
              <span className={x.decision === "risk" ? "redline-del" : ""}>{x.contract_excerpt}</span>
            </p>
          ) : null}
          {x.suggestion && (
            <p className="whitespace-pre-line">
              <span className="redline-ins">{x.suggestion}</span>
            </p>
          )}
          {x.suggestion_ko && x.suggestion_ko !== x.suggestion && <p className="whitespace-pre-line text-sm leading-relaxed text-slate">국문: {x.suggestion_ko}</p>}
        </div>
      )}
      <footer className="space-y-3 border-t border-line bg-paper/60 px-5 py-3">
        <p className="text-xs leading-relaxed text-slate">
          <span className="font-medium text-ink-soft">판단 이유</span> {x.why}
        </p>
        {x.decision === "needs_lawyer" && (
          <>
            <p className="text-sm leading-relaxed">
              <span className="mr-1 font-medium text-caution">변호사에게 물을 것</span>
              {x.lawyer_question}
            </p>
            <LawyerItemActions reviewId={reviewId} itemIndex={index} state={state ?? { status: "open" }} />
          </>
        )}
      </footer>
    </article>
  );
}

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const { id } = await params;
  const { show } = await searchParams;
  // 담당자가 유형을 바꿔 재검토 중이면 Studio Job 상태를 먼저 확인한다
  const sync = await syncReReview(id).catch(() => "running" as const);
  const [data, options, subNames] = await Promise.all([getContract(id), categoryOptions(), subtypeNames()]);
  if (!data) notFound();
  const { contract: c, category, subtype, review, standard, states } = data;
  const m = c.metadata;
  const r = review?.result;
  const names: Record<string, string> = { ...Object.fromEntries(subNames), ...Object.fromEntries(options.map((o) => [o.key, o.name])) };
  const items = (r?.items ?? []).map((x, i) => ({ x, i }));
  const groups = [
    { key: "risk", title: "수정 필요", desc: "법무팀 확정 기준을 벗어난 조항입니다. 수정 제안 문구가 Word 변경기록에 들어갑니다." },
    { key: "needs_lawyer", title: "변호사 확인", desc: "AI가 결론을 내리지 않은 항목입니다. 변호사 확인을 요청하세요." },
    { key: "note", title: "참고", desc: "결론이 필요 없는 형식 차이·추가 권고·적용 대상 아님." },
  ] as const;
  const shown = show && groups.some((g) => g.key === show) ? groups.filter((g) => g.key === show) : groups;
  const okItems = items.filter((y) => y.x.decision === "ok");
  const openLawyer = items.filter((y) => y.x.decision === "needs_lawyer" && (states.get(y.i)?.status ?? "open") === "open");
  const name = String(m.counterparty_name || m.contract_title || c.filename);
  const cs = CLASSIFY_STATE[c.classifyState];
  const reviewStale = review && category && review.bucket !== category.classKey;

  return (
    <div>
      <Crumbs items={[{ href: "/contracts", label: "계약서" }, { label: name }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
            <VerdictPill verdict={review?.verdict} size="lg" />
          </div>
          <p className="mt-2 text-sm text-slate">
            {m.contract_title ? `${m.contract_title}, ` : ""}
            {formatAmount(m.amount, m.currency)}, {LANG[c.language ?? ""] ?? c.language}
          </p>
          <p className="mt-0.5 break-all text-xs text-slate/80">{c.filename}</p>
        </div>
        {review && (
          <div className="flex flex-col items-end gap-1">
            <a href={`/api/contracts/${c.id}/redline`} className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink-soft">
              {standard ? "표준양식 변경기록(.docx) 받기" : "검토 의견서(.docx) 받기"}
            </a>
            <span className="text-xs text-slate">{standard ? `어댑트 표준 ${standard.standardId} 원본에 변경 내용·메모 표시` : "표준이 없는 유형: 공통 기준 검토 의견"}</span>
          </div>
        )}
      </div>

      {/* 분류 확인 */}
      <Panel className="mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate">유형</span>
              {category ? (
                <Link href={`/categories/${category.classKey}`} className="font-semibold hover:underline">
                  {category.name}
                </Link>
              ) : (
                <span className="font-semibold">미분류</span>
              )}
              {subtype && category?.classKey === "others" && <span className="text-sm text-slate">· 세부 {subtype.nameKo}</span>}
              <Pill cls={cs.cls}>{cs.label}</Pill>
              {c.classifyState === "suggested" && <LevelPill level={c.classification?.level} />}
              <EvidenceButton c={c.classification} names={names} />
            </div>
            <p className="mt-1.5 text-xs text-slate">
              {category?.hasStandard
                ? `어댑트 표준 ${category.standardId} 플레이북으로 조항별 검토`
                : category?.classKey === "others"
                  ? "상위 5개 유형이 아니라 전 표준 공통 기준(01_COMMON_POSITIONS)까지 검토"
                  : "어댑트 표준이 없는 유형: 공통 기준 + 유사 표준(INF-PAID) 참고, 차이는 변호사 확인"}
              {c.classifyNote ? ` · 메모: ${c.classifyNote}` : ""}
            </p>
          </div>
          <ClassifyActions contractId={c.id} current={category?.classKey ?? null} options={options} state={c.classifyState} />
        </div>
        {(c.needsReReview || reviewStale) && (
          <div className="mt-4 rounded-md bg-insert-tint px-3 py-2.5 text-sm text-insert">
            {c.reReviewJobId
              ? "바뀐 유형 기준으로 Studio에서 다시 검토하는 중입니다. 잠시 뒤 새로고침하면 결과가 반영됩니다."
              : sync === "failed"
                ? "재검토에 실패했습니다."
                : studioAvailable()
                  ? "유형이 바뀌어 재검토가 필요합니다."
                  : "유형이 바뀌어 재검토가 필요합니다. 이 배포에는 Studio 키가 없어 관리자가 일괄 재검토로 반영합니다."}
            {!c.reReviewJobId && studioAvailable() && (
              <form
                action={async () => {
                  "use server";
                  await retryReReview(c.id);
                }}
                className="mt-2"
              >
                <button className="rounded-md bg-insert px-3 py-1.5 text-sm font-medium text-white">지금 재검토</button>
              </form>
            )}
            <p className="mt-1 text-xs text-insert/80">아래 검토 결과는 이전 유형({review?.bucket ? names[review.bucket] ?? review.bucket : "-"}) 기준입니다.</p>
          </div>
        )}
      </Panel>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {!review && <Panel className="p-6 text-sm text-slate">아직 리스크 검토 결과가 없습니다.</Panel>}
          {r && review && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1 rounded-md bg-line/50 p-1 text-sm" aria-label="결론으로 거르기">
                  {[{ key: undefined, label: "모두" }, ...groups.map((g) => ({ key: g.key, label: g.title }))].map((f) => {
                    const active = show === f.key || (!show && !f.key);
                    const n = f.key ? items.filter((y) => y.x.decision === f.key).length : items.filter((y) => y.x.decision !== "ok").length;
                    return (
                      <Link
                        key={f.label}
                        href={f.key ? `?show=${f.key}` : "?"}
                        scroll={false}
                        aria-current={active ? "true" : undefined}
                        className={`rounded px-2.5 py-1 ${active ? "bg-white font-medium shadow-sm" : "text-slate hover:text-ink"}`}
                      >
                        {f.label} <span className="tabular-nums text-slate">{n}</span>
                      </Link>
                    );
                  })}
                </div>
                {openLawyer.length > 0 && (
                  <LawyerBulkRequest
                    reviewId={review.id}
                    indexes={openLawyer.map((y) => y.i)}
                    questions={[`[계약 검토 요청] ${name} (${category?.name ?? ""})`, ...openLawyer.map((y, k) => `${k + 1}. ${y.x.clause_ref}: ${y.x.lawyer_question}`)].join("\n")}
                  />
                )}
              </div>

              {shown.map((g) => {
                const list = items.filter((y) => y.x.decision === g.key);
                if (!list.length) return null;
                return (
                  <section key={g.key} className="space-y-3">
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight">
                        {g.title} <span className="font-normal text-slate">{list.length}</span>
                      </h2>
                      <p className="text-sm text-slate">{g.desc}</p>
                    </div>
                    {g.key === "risk" && (
                      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
                        <span>
                          <span className="redline-del">취소선</span> 지금 계약서 문구
                        </span>
                        <span>
                          <span className="redline-ins">밑줄</span> 수정 제안
                        </span>
                      </p>
                    )}
                    {list.map((y) => (
                      <ItemCard key={y.i} x={y.x} index={y.i} reviewId={review.id} state={states.get(y.i) as ItemState | undefined} />
                    ))}
                  </section>
                );
              })}
              {okItems.length > 0 && !show && (
                <details className="rounded-lg border border-line bg-white px-5 py-4 text-sm">
                  <summary className="cursor-pointer">
                    기준을 충족하는 항목 <b className="font-medium text-comply">{okItems.length}개</b>
                  </summary>
                  <ul className="mt-3 space-y-1.5 text-ink-soft">
                    {okItems.map((y) => (
                      <li key={y.i}>
                        {y.x.clause_ref}
                        {y.x.flags.within_allowed && y.x.issue ? <span className="text-xs text-slate"> · 허용 범위 안: {y.x.issue}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {r && review && (
            <Panel className="p-5">
              <h2 className="text-sm font-semibold">검토 의견</h2>
              <p className="mt-2 text-sm leading-relaxed">{r.overall_opinion}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
                <div>
                  <dd className="text-xl font-semibold tabular-nums text-redline">{review.riskCount}</dd>
                  <dt className="text-xs text-slate">수정 필요</dt>
                </div>
                <div>
                  <dd className="text-xl font-semibold tabular-nums text-caution">{review.lawyerCount}</dd>
                  <dt className="text-xs text-slate">변호사 확인</dt>
                </div>
                <div>
                  <dd className="text-xl font-semibold tabular-nums text-slate">{review.noteCount}</dd>
                  <dt className="text-xs text-slate">참고</dt>
                </div>
              </dl>
              {r.is_high_value && <p className="mt-3 rounded bg-insert-tint px-2.5 py-1.5 text-xs text-insert">1억 원 이상 계약: 검토 강도를 높여야 합니다</p>}
              {r.adapt_role === "role_reversed" && (
                <p className="mt-3 rounded bg-caution-tint px-2.5 py-1.5 text-xs text-caution">어댑트가 표준과 반대 지위입니다(역할 반전). 플레이북의 역할 반전 항목을 확인하세요.</p>
              )}
              <p className="mt-3 border-t border-line pt-3 text-xs text-slate">검토 모델 {review.model ?? "-"} · Studio 리스크 검토 Agent</p>
            </Panel>
          )}

          <Panel className="p-5 text-sm">
            <h2 className="font-semibold">계약 정보</h2>
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
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
