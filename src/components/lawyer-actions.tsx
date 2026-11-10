"use client";

import { useState, useTransition } from "react";
import { answerLawyer, reopenLawyer, requestLawyer } from "@/app/actions";

export type LawyerState = {
  status: "open" | "requested" | "answered";
  resolution?: string | null;
  answerNote?: string | null;
  requestNote?: string | null;
};

const RESOLUTIONS = ["수용 가능", "수정 요구", "삭제 요구", "추가 협상"];

/** 변호사 확인 항목 한 개의 조치: 요청 → 답변 기록 */
export function LawyerItemActions({ reviewId, itemIndex, state }: { reviewId: string; itemIndex: number; state: LawyerState }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [note, setNote] = useState("");
  const run = (f: () => Promise<{ message: string }>) => start(async () => setMsg((await f()).message));

  if (state.status === "answered") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-comply-tint px-2.5 py-0.5 text-xs font-medium text-comply">변호사 답변: {state.resolution}</span>
        {state.answerNote && <span className="text-xs text-ink-soft">{state.answerNote}</span>}
        <button type="button" disabled={pending} onClick={() => run(() => reopenLawyer(reviewId, itemIndex))} className="text-xs text-slate hover:text-ink hover:underline">
          되돌리기
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "open" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => requestLawyer(reviewId, [itemIndex]))}
            className="rounded-md bg-caution px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            변호사 확인 요청
          </button>
        ) : (
          <span className="rounded-full bg-caution-tint px-2.5 py-0.5 text-xs font-medium text-caution">요청됨 · 답변 대기</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setAnswering((v) => !v)}
          aria-expanded={answering}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper disabled:opacity-50"
        >
          변호사 답변 기록
        </button>
        {state.status === "requested" && (
          <button type="button" disabled={pending} onClick={() => run(() => reopenLawyer(reviewId, itemIndex))} className="text-xs text-slate hover:text-ink hover:underline">
            요청 취소
          </button>
        )}
      </div>
      {answering && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3 sm:flex-row sm:items-center">
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm" aria-label="변호사 판단">
            {RESOLUTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="답변 메모(선택)"
            className="min-w-0 flex-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => answerLawyer(reviewId, itemIndex, resolution, note))}
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
          >
            저장
          </button>
        </div>
      )}
      {msg && (
        <p className="text-xs text-slate" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

/** 한 계약서의 미요청 변호사 확인 항목을 한 번에 요청 + 질문 목록 복사 */
export function LawyerBulkRequest({ reviewId, indexes, questions }: { reviewId: string; indexes: number[]; questions: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {indexes.length > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setMsg((await requestLawyer(reviewId, indexes)).message))}
          className="rounded-md bg-caution px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {indexes.length}개 항목 모두 변호사 확인 요청
        </button>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(questions);
            setMsg("질문 목록을 복사했습니다. 메일·슬랙에 붙여 넣으세요.");
          } catch {
            setMsg("복사하지 못했습니다. 브라우저 권한을 확인하세요.");
          }
        }}
        className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper"
      >
        질문 목록 복사
      </button>
      {msg && (
        <span className="text-xs text-slate" role="status">
          {msg}
        </span>
      )}
    </div>
  );
}
