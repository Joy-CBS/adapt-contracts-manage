import Link from "next/link";
import { Empty, LANG, VerdictBadge, formatAmount } from "@/components/ui";
import { listCategories, listContracts } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; category?: string; verdict?: string; language?: string }>;

export default async function ContractsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [rows, cats] = await Promise.all([listContracts(sp), listCategories()]);
  const select = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">계약서 목록</h1>
        <p className="mt-2 text-neutral-600">리스크가 큰 계약서부터 표시합니다. 계약서를 누르면 조항별 검토와 Word 변경기록을 볼 수 있습니다.</p>
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/contracts">
        <input name="q" defaultValue={sp.q} placeholder="파일명 검색" className={`${select} w-56`} />
        <select name="category" defaultValue={sp.category ?? ""} className={select}>
          <option value="">전체 유형</option>
          {cats.map((c) => (
            <option key={c.classKey} value={c.classKey}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="verdict" defaultValue={sp.verdict ?? ""} className={select}>
          <option value="">전체 판정</option>
          <option value="red">수정 필요</option>
          <option value="yellow">확인 필요</option>
          <option value="green">표준 부합</option>
        </select>
        <select name="language" defaultValue={sp.language ?? ""} className={select}>
          <option value="">전체 언어</option>
          {Object.entries(LANG).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">적용</button>
        <span className="ml-auto text-sm text-neutral-500">{rows.length}건</span>
      </form>

      {rows.length === 0 ? (
        <Empty>조건에 맞는 계약서가 없습니다.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-normal">계약서</th>
                <th className="px-4 py-2 font-normal">유형</th>
                <th className="px-4 py-2 font-normal">상대방</th>
                <th className="px-4 py-2 text-right font-normal">금액</th>
                <th className="px-4 py-2 font-normal">판정</th>
                <th className="px-4 py-2 text-right font-normal">리스크 높음·중간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="max-w-[320px] px-4 py-2">
                    <Link href={`/contracts/${r.id}`} className="block truncate hover:underline" title={r.filename}>
                      {r.filename}
                    </Link>
                    <span className="text-xs text-neutral-400">
                      {LANG[r.language ?? ""] ?? r.language} · {r.folder}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.categoryName ?? "-"}
                    {r.confidence != null && <span className="ml-1 text-xs text-neutral-400">{Math.round(r.confidence * 100)}%</span>}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{String(r.metadata.counterparty_type ?? "-")}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{formatAmount(r.metadata.amount, r.metadata.currency)}</td>
                  <td className="px-4 py-2">
                    <VerdictBadge verdict={r.verdict} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span className={r.high ? "text-red-700" : "text-neutral-400"}>{r.high ?? 0}</span>
                    <span className="text-neutral-300"> · </span>
                    <span className={r.medium ? "text-amber-700" : "text-neutral-400"}>{r.medium ?? 0}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
