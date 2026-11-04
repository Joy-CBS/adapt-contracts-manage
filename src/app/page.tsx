import Link from "next/link";
import { Section, Stat } from "@/components/ui";
import { listCategories, overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

const flow = [
  { title: "계약서 인입", desc: "기존 계약서 일괄 적재 · Slack 검토 요청" },
  { title: "유형 판단", desc: "Studio Classify가 표준계약서 유형 판정 (신규면 유형 생성)" },
  { title: "리스크 분석", desc: "표준안 가드레일 대비 조항별 일치·일탈·누락 판단" },
  { title: "표준양식 변환", desc: "표준 조항 순서로 재구성, Word 변경기록·메모로 수정안 제시" },
];

export default async function Home() {
  const [o, cats] = await Promise.all([overview(), listCategories()]);
  const top = cats.slice(0, 5);
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-medium">계약서 검토 자동화</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          어댑트 계약서를 표준계약서 유형별로 분류하고, 표준안과 비교한 리스크와 수정 의견을 Word 변경기록으로 제공합니다. 현재 화면은
          기존 계약서 샘플 {o.contracts}건의 분석 결과입니다.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="분석한 계약서" value={o.contracts} hint={`리스크 검토 ${o.reviewed}건`} />
        <Stat label="표준계약서 유형" value={o.categories} hint="기존 계약서에서 도출(초안)" />
        <Stat label="수정 필요 계약서" value={o.red} hint={`확인 필요 ${o.yellow} · 표준 부합 ${o.green}`} />
        <Stat label="고위험 조항" value={o.highRisks} hint="가드레일을 크게 벗어난 조항 수" />
      </div>

      <Section title="처리 흐름">
        <ol className="grid gap-3 md:grid-cols-4">
          {flow.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-xs text-neutral-400">{i + 1}단계</div>
              <div className="mt-1 font-medium">{s.title}</div>
              <p className="mt-1 text-sm text-neutral-600">{s.desc}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="많이 쓰이는 유형"
        action={
          <Link href="/categories" className="text-sm text-neutral-500 hover:text-neutral-900">
            전체 카테고리 맵 →
          </Link>
        }
      >
        <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
          {top.map((c) => (
            <Link key={c.id} href={`/categories/${c.classKey}`} className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-50">
              <span className="flex-1">{c.name}</span>
              <span className="w-40">
                <span className="block h-1.5 rounded bg-neutral-100">
                  <span className="block h-1.5 rounded bg-neutral-800" style={{ width: `${Math.round((c.count / Math.max(o.contracts, 1)) * 100)}%` }} />
                </span>
              </span>
              <span className="w-12 text-right text-sm tabular-nums text-neutral-600">{c.count}건</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
