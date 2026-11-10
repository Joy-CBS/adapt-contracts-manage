"use client";

import { useEffect, useRef, useState } from "react";
import type { Classification } from "@/lib/review-types";

const LEVEL_TEXT = {
  strong: { label: "근거 충분", tone: "text-comply", desc: "두 판단이 일치하고 분류 기준의 신호가 충분합니다. 승인해도 되는 건입니다." },
  medium: { label: "근거 보통", tone: "text-insert", desc: "두 판단은 일치하지만 신호가 적거나 적합도가 보통입니다. 아래 근거를 훑어보고 승인하세요." },
  weak: { label: "확인 필요", tone: "text-caution", desc: "판단이 엇갈리거나 다른 유형일 가능성이 있습니다. 계약서를 열어 확인하세요." },
} as const;

/**
 * 분류 근거(i 버튼). Studio solar-pro4는 신뢰도 점수를 주지 않아,
 * Studio Classify 결과와 근거 분석(Instruct)이 같은지 + 어댑트 분류 기준 신호를 몇 개 확인했는지로 근거 수준을 매긴다.
 */
export function EvidenceButton({ c, names }: { c: Classification | null; names: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!c) return null;
  const lv = LEVEL_TEXT[c.level];
  const r = c.rationale;
  const name = (id?: string | null) => (id ? names[id] ?? id : "-");
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="분류 근거 보기"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate/40 text-[11px] font-semibold italic text-slate hover:border-ink hover:text-ink"
      >
        i
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-7 z-30 w-[min(92vw,26rem)] rounded-lg border border-line bg-white p-4 text-left text-sm shadow-lg sm:left-auto sm:right-0"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-semibold ${lv.tone}`}>{lv.label}</span>
            <span className="text-xs text-slate">모델 {c.model}{c.confidence != null ? ` · 신뢰도 ${Math.round(c.confidence * 100)}%` : " · 신뢰도 점수 없음"}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate">{lv.desc}</p>

          <h4 className="mt-3 text-xs font-semibold text-ink-soft">어떤 기준으로 판단했나</h4>
          <ul className="mt-1.5 space-y-1">
            {c.reasons.map((x, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className={x.ok ? "text-comply" : "text-caution"} aria-hidden>
                  {x.ok ? "✓" : "!"}
                </span>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>

          {r && (
            <>
              {r.explanation && <p className="mt-3 rounded-md bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">{r.explanation}</p>}
              {r.matched_include_signals.length > 0 && (
                <>
                  <h4 className="mt-3 text-xs font-semibold text-ink-soft">계약서에서 확인한 분류 신호</h4>
                  <ul className="mt-1.5 max-h-48 space-y-2 overflow-y-auto pr-1">
                    {r.matched_include_signals.slice(0, 5).map((s, i) => (
                      <li key={i}>
                        <div className="text-[13px]">{s.signal}</div>
                        {s.evidence && <div className="mt-0.5 line-clamp-2 border-l-2 border-line pl-2 text-xs text-slate">“{s.evidence}”</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {r.matched_exclude_signals.length > 0 && (
                <>
                  <h4 className="mt-3 text-xs font-semibold text-caution">다른 유형을 가리키는 신호</h4>
                  <ul className="mt-1.5 space-y-1.5">
                    {r.matched_exclude_signals.slice(0, 3).map((s, i) => (
                      <li key={i} className="text-[13px]">
                        {s.signal} <span className="text-slate">→ {name(s.points_to)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {r.runner_up_category_id && r.runner_up_category_id !== "none" && (
                <p className="mt-3 text-xs text-slate">
                  2순위 후보: {name(r.runner_up_category_id)} ({r.runner_up_fit}) — {r.runner_up_reason}
                </p>
              )}
            </>
          )}
          <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-slate">
            기준: 어댑트 분류체계(taxonomy) 정의·포함/제외 신호와 플레이북 INDEX 결정트리. Studio 분류 결과와 근거 분석이 같은지, 신호를 몇 개 확인했는지로 근거 수준을 정합니다.
          </p>
        </div>
      )}
    </div>
  );
}
