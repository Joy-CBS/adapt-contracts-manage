import Link from "next/link";
import { AutoRefresh, Stepper } from "@/components/flow";
import { Panel, VerdictPill } from "@/components/ui";
import { type RequestRow, listRequests } from "@/lib/queries";
import { nextAction } from "@/lib/request-status";
import { studioReady, syncRequest } from "@/lib/requests";

export const dynamic = "force-dynamic";

const when = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d)) : "";

function RequestCard({ r }: { r: RequestRow }) {
  const a = nextAction(r);
  const name = r.counterparty || r.title || r.filename;
  return (
    <li>
      <Link
        href={`/requests/${r.id}`}
        className={`group grid gap-3 rounded-lg border bg-white p-4 transition hover:border-ink/40 hover:shadow-sm sm:grid-cols-[1fr_auto] sm:items-center sm:p-5 ${
          a.owner === "mine" ? "border-line border-l-4 border-l-ink" : "border-line"
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold">{name}</span>
            {r.categoryName && <span className="text-sm text-slate">· {r.categoryName}</span>}
          </div>
          <p className={`mt-1 text-sm ${a.owner === "mine" ? "font-medium text-ink" : a.owner === "failed" ? "text-redline" : "text-slate"}`}>
            {a.owner === "waiting" && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-insert align-middle" aria-hidden />}
            {a.title}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Stepper step={a.step} done={a.owner === "done"} compact />
            <span className="text-xs text-slate">접수 {when(r.requestedAt)}</span>
            {r.verdict && <VerdictPill verdict={r.verdict} />}
          </div>
        </div>
        {a.cta && (
          <span
            className={`inline-flex justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ${
              a.owner === "mine" ? "bg-ink text-white group-hover:bg-ink-soft" : "border border-line text-ink group-hover:bg-paper"
            }`}
          >
            {a.cta} →
          </span>
        )}
      </Link>
    </li>
  );
}

export default async function RequestsHome() {
  // AI 처리 중인 요청은 Studio Job 상태를 먼저 확인해 단계를 넘긴다
  const first = await listRequests();
  const running = first.filter((r) => r.stage === "analyzing" || r.stage === "reviewing");
  if (running.length && studioReady()) await Promise.all(running.map((r) => syncRequest(r.id).catch(() => null)));
  const rows = running.length ? await listRequests() : first;

  const withAction = rows.map((r) => ({ r, a: nextAction(r) }));
  const mine = withAction.filter((x) => x.a.owner === "mine" || x.a.owner === "failed");
  const waiting = withAction.filter((x) => x.a.owner === "waiting");
  const done = withAction.filter((x) => x.a.owner === "done");
  const stillRunning = rows.some((r) => r.stage === "analyzing" || r.stage === "reviewing");

  const howItWorks = (
      <Panel className="p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink-soft">검토는 이렇게 진행돼요</h2>
      <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-5">
        {[
          ["계약서 올리기", "PDF·Word 파일을 올리면 AI가 읽습니다"],
          ["유형 확인", "AI가 제안한 어댑트 계약 유형이 맞는지 확인"],
          ["리스크 검토", "그 유형의 플레이북으로 조항별 자동 검토"],
          ["변호사 확인", "AI가 판단하지 않은 항목만 변호사에게 요청"],
          ["완료", "표준양식 수정본(Word)을 보내고 마무리"],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-2.5 sm:block">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-semibold text-ink-soft sm:mb-2">{i + 1}</span>
            <span>
              <b className="font-semibold">{t}</b>
              <span className="block text-xs leading-relaxed text-slate">{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );

  return (
    <div className="space-y-10">
      {stillRunning && <AutoRefresh />}
      <section className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight">검토 요청</h1>
          <p className="mt-2 leading-relaxed text-ink-soft">
            {mine.length > 0 ? (
              <>
                지금 처리할 계약서가 <b className="font-semibold text-ink">{mine.length}건</b> 있습니다. 위에서부터 차례로 열어 안내대로 진행하세요.
              </>
            ) : (
              "지금 처리할 계약서가 없습니다. 새 계약서를 올리면 AI가 유형 판단과 리스크 검토를 시작합니다."
            )}
          </p>
        </div>
        <Link href="/requests/new" className="inline-flex items-center rounded-md bg-ink px-5 py-3 font-medium text-white hover:bg-ink-soft">
          + 계약서 올려서 검토 요청
        </Link>
      </section>

      {mine.length === 0 && howItWorks}

      <section aria-labelledby="mine">
        <h2 id="mine" className="text-lg font-semibold">
          내가 처리할 차례 <span className="font-normal text-slate">{mine.length}</span>
        </h2>
        {mine.length ? (
          <ul className="mt-3 space-y-3">
            {mine.map(({ r }) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-slate">처리할 차례인 요청이 없습니다.</p>
        )}
      </section>

      {waiting.length > 0 && (
        <section aria-labelledby="waiting">
          <h2 id="waiting" className="text-lg font-semibold">
            기다리는 중 <span className="font-normal text-slate">{waiting.length}</span>
          </h2>
          <p className="text-sm text-slate">AI가 처리 중이거나 변호사 답변을 기다리는 요청입니다.</p>
          <ul className="mt-3 space-y-3">
            {waiting.map(({ r }) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}

      {mine.length > 0 && howItWorks}

      {done.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-lg font-semibold">
            완료 <span className="font-normal text-slate">{done.length}</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {done.map(({ r }) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
