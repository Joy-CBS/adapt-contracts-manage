import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Crumbs, LANG, Section, SeverityBadge, VerdictBadge, formatAmount } from "@/components/ui";
import { getContract } from "@/lib/queries";

export const dynamic = "force-dynamic";

const META: Array<[string, string]> = [
  ["contract_title", "제목"],
  ["contract_type", "계약 성격"],
  ["adapt_entity", "어댑트 측"],
  ["adapt_role", "어댑트 역할"],
  ["counterparty_name", "상대방"],
  ["counterparty_type", "상대방 유형"],
  ["brands", "브랜드"],
  ["channels", "채널"],
  ["territory", "지역"],
  ["term", "기간"],
  ["secondary_use_period", "2차 활용"],
  ["payment_terms", "지급 조건"],
];

const STATUS_CLS: Record<string, string> = {
  일치: "text-emerald-700",
  일탈: "text-red-700",
  누락: "text-amber-700",
  추가조항: "text-violet-700",
};

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getContract(id);
  if (!data) notFound();
  const { contract: c, category, review, template } = data;
  const m = c.metadata;
  const r = review?.result;
  const issues = r?.clause_reviews.filter((x) => x.status !== "일치") ?? [];
  const ok = r?.clause_reviews.filter((x) => x.status === "일치") ?? [];
  const order = { high: 0, medium: 1, low: 2, none: 3 } as Record<string, number>;
  issues.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  return (
    <div className="space-y-8">
      <Crumbs items={[{ href: "/contracts", label: "계약서 목록" }, { label: c.filename }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-all text-xl font-medium">{c.filename}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            {category && (
              <Link href={`/categories/${category.classKey}`} className="hover:underline">
                {category.name}
              </Link>
            )}
            {c.classifyConfidence != null && <span className="text-neutral-400">판단 신뢰도 {Math.round(c.classifyConfidence * 100)}%</span>}
            <span className="text-neutral-300">·</span>
            <span>{LANG[c.language ?? ""] ?? c.language}</span>
            <span className="text-neutral-300">·</span>
            <span>{formatAmount(m.amount, m.currency)}</span>
            {r?.is_high_value && <Badge cls="bg-violet-50 text-violet-700 ring-violet-200">1억 원 이상</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={review?.verdict} />
          {review && (
            <a href={`/api/contracts/${c.id}/redline`} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700">
              Word 변경기록 받기
            </a>
          )}
        </div>
      </div>

      {r && (
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-sm text-neutral-500">검토 의견</div>
            <p className="mt-1 whitespace-pre-line">{r.overall_opinion}</p>
            <p className="mt-3 text-sm text-neutral-500">{r.summary}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            <div className="text-neutral-500">조항 검토</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-2xl tabular-nums text-red-700">{review?.highCount}</div>
                <div className="text-xs text-neutral-500">높음</div>
              </div>
              <div>
                <div className="text-2xl tabular-nums text-amber-700">{review?.mediumCount}</div>
                <div className="text-xs text-neutral-500">중간</div>
              </div>
              <div>
                <div className="text-2xl tabular-nums text-sky-700">{review?.lowCount}</div>
                <div className="text-xs text-neutral-500">낮음</div>
              </div>
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              기준: {template?.title_ko ?? "-"}
              {template?.status === "draft" && " (초안)"}
            </div>
          </div>
        </div>
      )}

      {!review && <p className="text-sm text-neutral-500">아직 리스크 검토 결과가 없습니다.</p>}

      {issues.length > 0 && (
        <Section title={`검토가 필요한 조항 ${issues.length}개`}>
          <div className="space-y-3">
            {issues.map((x, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={x.severity} />
                  <span className={`text-sm ${STATUS_CLS[x.status] ?? ""}`}>{x.status}</span>
                  <span className="font-medium">
                    {x.standard_clause_no > 0 ? `제${x.standard_clause_no}조 ` : ""}
                    {x.standard_clause_title}
                  </span>
                </div>
                <p className="mt-2 text-sm">{x.issue}</p>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-lg bg-red-50/60 p-3">
                    <div className="mb-1 text-xs text-neutral-500">계약서 원문</div>
                    <p className="whitespace-pre-line text-neutral-700">{x.contract_excerpt || "(해당 조항 없음)"}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50/60 p-3">
                    <div className="mb-1 text-xs text-neutral-500">수정 제안</div>
                    <p className="whitespace-pre-line text-neutral-700">{x.suggestion || "-"}</p>
                    {x.suggestion_ko && x.suggestion_ko !== x.suggestion && <p className="mt-2 whitespace-pre-line text-neutral-500">{x.suggestion_ko}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {ok.length > 0 && (
        <Section title={`표준안과 일치 ${ok.length}개`}>
          <div className="flex flex-wrap gap-2">
            {ok.map((x, i) => (
              <Badge key={i} cls="bg-emerald-50 text-emerald-700 ring-emerald-200">
                제{x.standard_clause_no}조 {x.standard_clause_title}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <Section title="추출 메타데이터">
        <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm md:grid-cols-2">
          {META.map(([k, label]) => {
            const v = m[k];
            const s = Array.isArray(v) ? v.join(", ") : String(v ?? "");
            return (
              <div key={k} className="grid grid-cols-[96px_1fr] gap-2">
                <dt className="text-neutral-500">{label}</dt>
                <dd className="break-words">{s || "-"}</dd>
              </div>
            );
          })}
        </dl>
      </Section>
    </div>
  );
}
