import { notFound } from "next/navigation";
import { ArchiveTypeFix } from "@/components/archive-type";
import { EvidenceButton } from "@/components/evidence";
import { AutoRefresh } from "@/components/flow";
import { type ItemState, ReviewItems } from "@/components/review-items";
import { Crumbs, LANG, Panel, Pill, VerdictPill, formatAmount } from "@/components/ui";
import { categoryOptions, getContract } from "@/lib/queries";
import { studioReady, syncRequest } from "@/lib/requests";

export const dynamic = "force-dynamic";

const FACTS: Array<[string, string]> = [
  ["contract_title", "계약명"],
  ["adapt_entity", "어댑트 측"],
  ["signed_date", "체결일"],
  ["term", "계약 기간"],
  ["payment_terms", "지급 조건"],
  ["territory", "지역"],
  ["brands", "브랜드"],
  ["channels", "채널"],
];

export default async function ArchiveContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (studioReady()) await syncRequest(id).catch(() => null);
  const [data, options] = await Promise.all([getContract(id), categoryOptions()]);
  if (!data) notFound();
  const { contract: c, category, review, standard, states } = data;
  const m = c.metadata;
  const name = String(m.counterparty_name || m.contract_title || c.filename);
  const names = Object.fromEntries(options.map((o) => [o.key, o.name]));
  const stateMap = new Map<number, ItemState>([...states].map(([k, v]) => [k, { status: v.status, resolution: v.resolution, answerNote: v.answerNote }]));
  const reviewing = c.stage === "reviewing";

  return (
    <div>
      {reviewing && <AutoRefresh />}
      <Crumbs items={[{ href: "/archive", label: "계약서 보관함" }, ...(category ? [{ href: `/archive?type=${category.classKey}`, label: category.name }] : []), { label: name }]} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{name}</h1>
            <VerdictPill verdict={review?.verdict} size="lg" />
          </div>
          <p className="mt-1 break-all text-sm text-slate">{c.filename}</p>
        </div>
        {review && (
          <a href={`/api/contracts/${c.id}/redline`} className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-ink-soft">
            {standard ? "표준양식 수정본(.docx)" : "검토 의견서(.docx)"}
          </a>
        )}
      </div>

      <Panel className="mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate">유형</span>
              <span className="font-semibold">{category?.name ?? "미분류"}</span>
              {c.classifyState === "suggested" && <Pill cls="bg-caution-tint text-caution">분류 확인 필요</Pill>}
              <EvidenceButton c={c.classification} names={names} />
            </div>
            <p className="mt-1 text-xs text-slate">
              {category?.hasStandard ? `어댑트 표준 ${category.standardId} 플레이북으로 검토` : "어댑트 표준이 없는 유형 · 공통 기준으로 검토"}
            </p>
          </div>
          <ArchiveTypeFix contractId={c.id} current={category?.classKey ?? null} options={options} needsCheck={c.classifyState === "suggested"} />
        </div>
        {reviewing && <p className="mt-3 rounded-md bg-insert-tint px-3 py-2 text-sm text-insert">바뀐 유형 기준으로 다시 검토하고 있어요. 1~2분 뒤 자동으로 반영됩니다.</p>}
      </Panel>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          {review ? <ReviewItems items={review.result.items} reviewId={review.id} states={stateMap} /> : <p className="text-sm text-slate">검토 결과가 없습니다.</p>}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {review?.result.overall_opinion && (
            <Panel className="p-5 text-sm">
              <h2 className="font-semibold">검토 의견</h2>
              <p className="mt-2 leading-relaxed">{review.result.overall_opinion}</p>
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
        </aside>
      </div>
    </div>
  );
}
