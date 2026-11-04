import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Crumbs, LANG, Section, SeverityBadge, VerdictBadge } from "@/components/ui";
import { getCategory, listContracts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const data = await getCategory(key);
  if (!data) notFound();
  const { category: c, template: t } = data;
  const members = await listContracts({ category: key });

  return (
    <div className="space-y-8">
      <Crumbs items={[{ href: "/categories", label: "카테고리 맵" }, { label: c.name }]} />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-medium">{c.name}</h1>
          <Badge>{members.length}건</Badge>
          {!c.standardizable && <Badge cls="bg-amber-50 text-amber-800 ring-amber-200">정형화 어려움</Badge>}
        </div>
        <p className="mt-2 max-w-3xl text-neutral-600">{c.definition}</p>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-white p-3 ring-1 ring-neutral-200">
            <dt className="text-neutral-500">포함 기준</dt>
            <dd className="mt-1">{c.includeCriteria}</dd>
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-neutral-200">
            <dt className="text-neutral-500">제외 기준</dt>
            <dd className="mt-1">{c.excludeCriteria}</dd>
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-neutral-200">
            <dt className="text-neutral-500">표준화 판단</dt>
            <dd className="mt-1">{c.standardizableReason}</dd>
          </div>
        </dl>
      </div>

      <Section title={t ? `표준안: ${t.title_ko}` : "표준안"} action={t && <Badge>{t.status === "draft" ? "초안 · 법무팀 확정 전" : "확정"}</Badge>}>
        {!t ? (
          <p className="text-sm text-neutral-500">아직 표준안이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {t.notes && <p className="text-sm text-neutral-600">{t.notes}</p>}
            {t.clauses.map((cl) => (
              <details key={cl.no} className="group rounded-xl border border-neutral-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="w-12 shrink-0 text-sm text-neutral-400">제{cl.no}조</span>
                  <span className="flex-1 font-medium">{cl.title_ko}</span>
                  <span className="hidden text-xs text-neutral-400 sm:inline">{cl.kind === "commercial" ? "커머셜" : "법적"}</span>
                  <SeverityBadge severity={cl.severity_if_deviating} />
                </summary>
                <div className="grid gap-4 border-t border-neutral-100 px-4 py-4 text-sm md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-neutral-500">표준 문구</div>
                    <p className="whitespace-pre-line">{cl.text_ko}</p>
                    <p className="mt-2 whitespace-pre-line text-neutral-500">{cl.text_en}</p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 text-xs text-neutral-500">가드레일</div>
                      <p className="whitespace-pre-line">{cl.guardrail}</p>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-neutral-500">일탈 시 리스크</div>
                      <p className="whitespace-pre-line">{cl.risk_if_deviating}</p>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>

      <Section title="이 유형의 계약서">
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-normal">계약서</th>
                <th className="px-4 py-2 font-normal">언어</th>
                <th className="px-4 py-2 font-normal">판정</th>
                <th className="px-4 py-2 font-normal">고·중위험</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-2">
                    <Link href={`/contracts/${m.id}`} className="hover:underline">
                      {m.filename}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{LANG[m.language ?? ""] ?? m.language}</td>
                  <td className="px-4 py-2">
                    <VerdictBadge verdict={m.verdict} />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-neutral-600">
                    {m.high ?? 0} · {m.medium ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
