import { Crumbs } from "@/components/ui";
import { UploadForm } from "./upload-form";

export default function NewRequestPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Crumbs items={[{ href: "/", label: "검토 요청" }, { label: "새 검토 요청" }]} />
      <h1 className="text-2xl font-semibold tracking-tight">새 검토 요청</h1>
      <p className="mt-2 text-ink-soft">
        계약서를 올리면 AI가 어댑트 계약 유형을 판단합니다. 유형을 확인해 주시면 그 유형의 플레이북으로 조항별 리스크를 검토하고, 표준양식에 변경 내용을 표시한 Word 파일을 만듭니다.
      </p>
      <div className="mt-8">
        <UploadForm />
      </div>
      <p className="mt-8 text-xs leading-relaxed text-slate">Slack 연동이 켜지면 Slack에 올린 검토 요청도 이 목록으로 들어옵니다.</p>
    </div>
  );
}
