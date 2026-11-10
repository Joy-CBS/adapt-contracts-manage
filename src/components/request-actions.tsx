"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeRequest, reopenRequest, requestLawyer } from "@/app/actions";

/** 4단계: 질문 복사 → 보냈다고 표시 */
export function LawyerHandoff({ reviewId, indexes, questions }: { reviewId: string; indexes: number[]; questions: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ol className="space-y-3 text-sm">
        <li className="flex flex-wrap items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold">1</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(questions);
                setCopied(true);
              } catch {
                setMsg("복사하지 못했습니다. 아래 항목에서 질문을 직접 확인하세요.");
              }
            }}
            className="rounded-md border border-ink/20 bg-white px-4 py-2 font-medium hover:bg-paper"
          >
            {copied ? "✓ 복사했어요" : `질문 ${indexes.length}개 복사하기`}
          </button>
          <span className="text-slate">메일·Slack에 붙여 넣어 변호사에게 보내세요.</span>
        </li>
        <li className="flex flex-wrap items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold">2</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await requestLawyer(reviewId, indexes);
                setMsg(r.ok ? null : r.message);
                router.refresh();
              })
            }
            className="rounded-md bg-ink px-4 py-2 font-medium text-white hover:bg-ink-soft disabled:opacity-50"
          >
            {pending ? "표시하는 중…" : "보냈어요 · 답변 대기로 바꾸기"}
          </button>
        </li>
      </ol>
      {msg && <p className="text-sm text-redline">{msg}</p>}
    </div>
  );
}

export function CompleteButton({ contractId, done }: { contractId: string; done: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return done ? (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => (await reopenRequest(contractId), router.refresh()))}
      className="text-sm text-slate hover:text-ink hover:underline"
    >
      다시 진행 중으로 돌리기
    </button>
  ) : (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => (await completeRequest(contractId), router.refresh()))}
      className="rounded-md bg-comply px-5 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "처리하는 중…" : "검토 완료 처리"}
    </button>
  );
}
