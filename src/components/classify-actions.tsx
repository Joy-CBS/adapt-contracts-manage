"use client";

import { useState, useTransition } from "react";
import { approveAllStrong, approveClassification, changeClassification, resetClassification } from "@/app/actions";

type Option = { key: string; name: string };

/** 분류 확인: 승인 / 다른 유형으로 / 기타로 */
export function ClassifyActions({
  contractId,
  current,
  options,
  state,
  compact = false,
}: {
  contractId: string;
  current: string | null;
  options: Option[];
  state: "suggested" | "approved" | "changed";
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState(options.find((o) => o.key !== current)?.key ?? "");
  const run = (f: () => Promise<{ message: string }>) => start(async () => setMsg((await f()).message));

  if (state !== "suggested") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" disabled={pending} onClick={() => run(() => resetClassification(contractId))} className="text-xs text-slate underline-offset-2 hover:text-ink hover:underline">
          분류 결정 되돌리기
        </button>
        {msg && <span className="text-xs text-slate" role="status">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveClassification([contractId]))}
          className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
        >
          승인
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper disabled:opacity-50"
        >
          다른 유형으로
        </button>
        {current !== "others" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => changeClassification(contractId, "others"))}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper disabled:opacity-50"
          >
            기타로 분류
          </button>
        )}
      </div>
      {picking && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-md border border-line bg-white px-2 py-1.5 text-sm"
            aria-label="바꿀 유형"
          >
            {options
              .filter((o) => o.key !== current)
              .map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={pending || !target}
            onClick={() => run(() => changeClassification(contractId, target))}
            className="rounded-md bg-insert px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            이 유형으로 바꾸고 재검토
          </button>
        </div>
      )}
      {!compact && <p className="text-xs text-slate">유형을 바꾸면 새 유형의 플레이북 기준으로 리스크 검토를 다시 합니다.</p>}
      {msg && (
        <p className="text-xs text-ink-soft" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

export function ApproveStrongButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (!count) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setMsg((await approveAllStrong()).message))}
        className="rounded-md bg-comply px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        근거 충분 {count}건 한 번에 승인
      </button>
      {msg && <span className="text-xs text-slate" role="status">{msg}</span>}
    </span>
  );
}
