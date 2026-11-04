import Link from "next/link";
import { Badge, Empty } from "@/components/ui";
import { listCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const cats = await listCategories();
  const total = cats.reduce((a, c) => a + c.count, 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">카테고리 맵</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          기존 계약서를 표준계약서 한 종으로 관리할 수 있는 단위로 묶은 결과입니다. 각 유형의 표준안은 대표 계약서와 같은 유형
          계약서들의 조항 편차를 바탕으로 만든 초안이며, 어댑트 표준계약서 원본을 받으면 교체합니다.
        </p>
      </div>
      {cats.length === 0 ? (
        <Empty>아직 카테고리가 없습니다. F2 결과를 적재하세요(npm run db:seed).</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <Link key={c.id} href={`/categories/${c.classKey}`} className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{c.name}</span>
                <span className="shrink-0 text-lg tabular-nums">{c.count}</span>
              </div>
              <p className="mt-2 line-clamp-3 flex-1 text-sm text-neutral-600">{c.definition}</p>
              <div className="mt-3 h-1.5 rounded bg-neutral-100">
                <div className="h-1.5 rounded bg-neutral-800" style={{ width: `${Math.max(2, Math.round((c.count / Math.max(total, 1)) * 100))}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.origin === "new" && <Badge cls="bg-violet-50 text-violet-700 ring-violet-200">신규 유형</Badge>}
                {c.hasTemplate ? <Badge>표준안 초안</Badge> : <Badge cls="bg-neutral-50 text-neutral-400 ring-neutral-200">표준안 없음</Badge>}
                {!c.standardizable && <Badge cls="bg-amber-50 text-amber-800 ring-amber-200">정형화 어려움</Badge>}
                {c.high > 0 && <Badge cls="bg-red-50 text-red-700 ring-red-200">수정 필요 {c.high}건</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
