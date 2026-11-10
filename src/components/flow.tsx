"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { STEPS } from "@/lib/request-status";

/** AI 처리 중일 때 몇 초마다 화면을 새로 그린다 */
export function AutoRefresh({ seconds = 6 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** 진행 단계 표시: 끝난 단계 ✓, 지금 단계 강조 */
export function Stepper({ step, done = false, compact = false }: { step: number; done?: boolean; compact?: boolean }) {
  return (
    <ol className={`flex items-center ${compact ? "gap-1" : "gap-1.5 sm:gap-2"}`} aria-label="진행 단계">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = done || n < step ? "done" : n === step ? "now" : "next";
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-2" aria-current={state === "now" ? "step" : undefined}>
            {compact ? (
              <span
                title={label}
                className={`block h-1.5 w-6 rounded-full sm:w-8 ${state === "done" ? "bg-comply" : state === "now" ? "bg-ink" : "bg-line"}`}
              />
            ) : (
              <>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    state === "done" ? "bg-comply text-white" : state === "now" ? "bg-ink text-white" : "bg-line text-slate"
                  }`}
                >
                  {state === "done" ? "✓" : n}
                </span>
                <span className={`hidden whitespace-nowrap text-sm sm:inline ${state === "now" ? "font-semibold text-ink" : "text-slate"}`}>{label}</span>
                {n < STEPS.length && <span className="h-px w-3 bg-line sm:w-6" aria-hidden />}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
