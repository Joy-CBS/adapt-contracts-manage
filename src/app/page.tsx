import Link from "next/link";
import { ApproveStrongButton } from "@/components/classify-actions";
import { CtaLink, Meter, Panel, Section, pct } from "@/components/ui";
import { hotClauses, listCategories, overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Step = {
  no: number;
  title: string;
  count: number;
  unit: string;
  desc: string;
  done: string;
  cta?: React.ReactNode;
  tone: "amber" | "red" | "ink" | "comply";
};

function StepCard({ s, current }: { s: Step; current: boolean }) {
  const finished = s.count === 0;
  return (
    <li
      className={`relative rounded-lg border bg-white p-5 ${current ? "border-ink shadow-[0_1px_0_0_var(--color-ink)]" : "border-line"} ${finished ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            finished ? "bg-comply-tint text-comply" : current ? "bg-ink text-white" : "bg-paper text-slate"
          }`}
          aria-hidden
        >
          {finished ? "✓" : s.no}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-semibold">{s.title}</h3>
            {current && !finished && <span className="text-xs font-medium text-insert">지금 할 일</span>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate">{finished ? s.done : s.desc}</p>
          {!finished && <div className="mt-3 flex flex-wrap items-center gap-2">{s.cta}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-semibold tabular-nums ${finished ? "text-comply" : s.tone === "red" ? "text-redline" : s.tone === "amber" ? "text-caution" : "text-ink"}`}>
            {s.count}
          </div>
          <div className="text-xs text-slate">{s.unit}</div>
        </div>
      </div>
    </li>
  );
}

export default async function Home() {
  const [o, cats, hot] = await Promise.all([overview(), listCategories(), hotClauses(6)]);
  const steps: Step[] = [
    {
      no: 1,
      title: "AI 분류 확인",
      count: o.pending,
      unit: "건 승인 대기",
      tone: "amber",
      desc: `AI가 어댑트 분류체계로 나눈 유형을 확정합니다. 확인 필요 ${o.pendingWeak}건부터 보세요. 유형을 바꾸면 새 기준으로 다시 검토합니다.`,
      done: "모든 계약서의 유형이 확정됐습니다.",
      cta: (
        <>
          <CtaLink href="/classify">분류 확인하기</CtaLink>
          <ApproveStrongButton count={o.pendingStrong} />
        </>
      ),
    },
    {
      no: 2,
      title: "변호사 확인 요청",
      count: o.lawyer.open,
      unit: `개 항목 · 계약 ${o.lawyer.openContracts}건`,
      tone: "amber",
      desc: "AI가 결론을 내리지 않은 항목입니다(알림 규칙 해당, 필수 조항 이탈, 확정 기준 없음). 질문을 복사해 변호사에게 보내고 요청으로 표시하세요.",
      done: "요청할 변호사 확인 항목이 없습니다.",
      cta: <CtaLink href="/lawyer">항목 보고 요청하기</CtaLink>,
    },
    {
      no: 3,
      title: "수정본 보내기",
      count: o.riskContracts,
      unit: "건 수정 필요",
      tone: "red",
      desc: "법무팀 확정 기준을 벗어난 조항이 있는 계약입니다. 어댑트 표준 양식에 변경 내용을 표시한 Word 파일을 내려받아 상대방에게 수정을 요청하세요.",
      done: "확정 기준을 벗어난 계약이 없습니다.",
      cta: <CtaLink href="/contracts?verdict=red" tone="ghost">수정 필요 계약 보기</CtaLink>,
    },
    {
      no: 4,
      title: "변호사 답변 기록",
      count: o.lawyer.requested,
      unit: "개 항목 답변 대기",
      tone: "ink",
      desc: "요청한 항목에 변호사 답변(수용·수정 요구 등)이 오면 기록해 검토를 마무리합니다.",
      done: "답변을 기다리는 항목이 없습니다.",
      cta: <CtaLink href="/lawyer?tab=requested" tone="ghost">답변 기록하기</CtaLink>,
    },
  ];
  if (o.rereview > 0)
    steps.splice(1, 0, {
      no: 0,
      title: "재검토 확인",
      count: o.rereview,
      unit: "건 재검토 중",
      tone: "ink",
      desc: "담당자가 유형을 바꾼 계약입니다. 새 유형 기준으로 다시 검토한 결과가 반영되면 사라집니다.",
      done: "",
      cta: <CtaLink href="/contracts?state=rereview" tone="ghost">재검토 대상 보기</CtaLink>,
    });
  steps.forEach((s, i) => (s.no = i + 1));
  const current = steps.find((s) => s.count > 0)?.no;
  const top5 = cats.filter((c) => c.classKey !== "others");
  const covered = top5.reduce((a, c) => a + c.count, 0);

  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-end">
        <div>
          <p className="text-sm font-medium text-slate">검토 담당자 할 일</p>
          <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight md:text-[2.4rem]">
            {current ? (
              <>
                {steps[current - 1].title}부터 시작하세요
              </>
            ) : (
              "오늘 처리할 일을 모두 마쳤습니다"
            )}
          </h1>
          <p className="mt-4 max-w-[62ch] leading-relaxed text-ink-soft">
            계약서 {o.contracts}건 중 <b className="font-semibold text-ink">{o.done}건</b>의 검토가 끝났습니다. AI는 어댑트 플레이북의 확정 기준으로만 수정 필요를 판단하고,
            판단이 어려운 항목은 결론 없이 변호사 확인으로 넘깁니다.
          </p>
        </div>
        <Panel className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate">검토 완료</span>
            <span className="text-sm tabular-nums text-slate">
              <b className="text-2xl font-semibold text-ink">{pct(o.done, o.contracts)}%</b> · {o.done}/{o.contracts}건
            </span>
          </div>
          <div className="mt-3">
            <Meter value={o.done} max={o.contracts} cls="bg-comply" />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
            <div>
              <dt className="text-xs text-slate">수정 필요</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-redline">{o.red}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">변호사 확인</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-caution">{o.yellow}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate">기준 충족</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-comply">{o.green}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate">검토 완료 = 유형 확정 + 변호사 확인 항목 답변 완료.</p>
        </Panel>
      </section>

      <Section title="처리 순서" desc="위에서부터 차례로 처리하면 됩니다. 각 단계의 버튼이 해당 작업 화면으로 연결됩니다.">
        <ol className="grid gap-3">
          {steps.map((s) => (
            <StepCard key={s.title} s={s} current={s.no === current} />
          ))}
        </ol>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section
          title="유형별 현황"
          desc={`상위 5개 유형이 계약서의 ${pct(covered, o.contracts)}%입니다. 나머지는 기타로 묶어 공통 기준까지 검토합니다.`}
          action={
            <Link href="/categories" className="text-sm text-insert hover:underline">
              표준계약서 보기
            </Link>
          }
        >
          <Panel>
            <ul className="divide-y divide-line">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.classKey}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-paper">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-xs text-slate">
                        {c.hasStandard ? `어댑트 표준 ${c.standardId}` : c.classKey === "others" ? "공통 기준 검토" : "표준 없음 · 공통 기준 + 유사 표준 참고"}
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums">{c.count}건</span>
                    <span className="col-span-2 flex h-1.5 overflow-hidden rounded-full bg-line/70" aria-label={`수정 필요 ${c.red}, 변호사 확인 ${c.yellow}, 기준 충족 ${c.green}`}>
                      <span className="bg-redline" style={{ width: `${pct(c.red, c.count)}%` }} />
                      <span className="bg-caution" style={{ width: `${pct(c.yellow, c.count)}%` }} />
                      <span className="bg-comply" style={{ width: `${pct(c.green, c.count)}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>

        <Section title="자주 걸리는 조항" desc="여러 계약에서 반복해서 수정 필요·변호사 확인이 나온 항목입니다. 플레이북 보완이나 표준 문구 협상 가이드 후보입니다.">
          <Panel>
            <ul className="divide-y divide-line">
              {hot.map((h) => (
                <li key={`${h.classKey}-${h.clause}`}>
                  <Link href={`/categories/${h.classKey}`} className="block px-4 py-3 hover:bg-paper">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{h.clause}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{pct(h.n, h.reviewed)}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate">
                      <span className="truncate">{h.categoryName}</span>
                      <span className="shrink-0">
                        {h.reviewed}건 중 수정 필요 {h.risk} · 변호사 확인 {h.lawyer}
                      </span>
                    </div>
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
