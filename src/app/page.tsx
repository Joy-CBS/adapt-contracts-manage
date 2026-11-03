const steps = [
  { id: "F1", title: "기존 계약서 일괄 적재", desc: "Studio Parse·Extract로 메타데이터를 추출해 Collection에 적재" },
  { id: "F2", title: "카테고리·표준안", desc: "class-generate와 그룹화로 유형 체계와 표준안 후보 도출" },
  { id: "F3", title: "유형 판단", desc: "신규 계약서가 기존 유형(중복)인지 신규인지 판단, 신규면 유형 생성" },
  { id: "F4", title: "리스크 분석", desc: "표준안 대비 조항 일탈과 리스크 도출" },
  { id: "F5", title: "표준양식 변환", desc: "표준양식으로 변환하고 Word 변경기록으로 수정 의견 표시" },
  { id: "F6", title: "Slack 연동", desc: "검토 요청 채널 후킹, 법무팀 채널로 결과 회신" },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-medium">계약서 검토 자동화 PoC</h1>
        <p className="mt-2 text-neutral-600">
          어댑트 계약서를 표준계약서 유형별로 분류하고, 신규 검토 요청에 대해 리스크와 수정 의견을 Word
          변경기록으로 제공합니다.
        </p>
      </section>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs text-neutral-400">{s.id}</div>
            <div className="mt-1 font-medium">{s.title}</div>
            <p className="mt-1 text-sm text-neutral-600">{s.desc}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
