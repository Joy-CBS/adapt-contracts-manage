"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmType, registerNewType } from "@/app/actions";
import type { Classification } from "@/lib/review-types";

type Option = { key: string; name: string; group: string | null; hasStandard: boolean; standardId: string | null; status: string | null };

const LEVEL = {
  strong: { label: "근거 충분", cls: "bg-comply-tint text-comply", say: "AI가 확신하는 편입니다." },
  medium: { label: "근거 보통", cls: "bg-insert-tint text-insert", say: "근거를 한 번 훑어보세요." },
  weak: { label: "확인 필요", cls: "bg-caution-tint text-caution", say: "다른 유형일 수 있어요. 근거를 꼭 확인하세요." },
} as const;

function criteria(o?: Option) {
  if (!o) return "";
  if (o.hasStandard) return `어댑트 표준 ${o.standardId} 플레이북으로 조항별 검토`;
  if (o.key === "tw_inf") return "표준 없음 · 공통 기준 + 유사 표준(INF-PAID) 참고로 검토";
  return "어댑트 표준 없음 · 공통 기준으로 검토";
}

/** 2단계 유형 확인: 맞음 / 다른 유형 / 새 유형 */
export function TypeConfirm({ contractId, c, options }: { contractId: string; c: Classification | null; options: Option[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"main" | "other" | "new">("main");
  const [msg, setMsg] = useState<string | null>(null);
  const byKey = new Map(options.map((o) => [o.key, o]));
  const suggested = c?.suggested ?? "";
  const sug = byKey.get(suggested);
  const alternatives = (c?.candidates ?? []).filter((k) => k !== suggested && byKey.has(k));
  const [pick, setPick] = useState(alternatives[0] ?? options.find((o) => o.key !== suggested)?.key ?? "");
  const [newName, setNewName] = useState("");
  const [newDef, setNewDef] = useState("");
  const lv = LEVEL[c?.level ?? "weak"];
  const r = c?.rationale;
  const groups = [...new Set(options.map((o) => o.group ?? "기타"))];

  const run = (f: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const res = await f();
      setMsg(res.ok ? null : res.message);
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate">AI가 판단한 유형</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-2xl font-semibold tracking-tight">{sug?.name ?? suggested}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${lv.cls}`}>{lv.label}</span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {criteria(sug)} · {lv.say}
        </p>
      </div>

      {c && (
        <div className="rounded-md bg-paper p-4 text-sm">
          <h3 className="font-semibold">왜 이 유형인가요?</h3>
          {r?.explanation && <p className="mt-1.5 leading-relaxed text-ink-soft">{r.explanation}</p>}
          <ul className="mt-2.5 space-y-1">
            {c.reasons.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className={x.ok ? "text-comply" : "text-caution"} aria-hidden>
                  {x.ok ? "✓" : "!"}
                </span>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
          {r && r.matched_include_signals.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-insert">계약서에서 찾은 근거 문구 {Math.min(r.matched_include_signals.length, 5)}개 보기</summary>
              <ul className="mt-2 space-y-2">
                {r.matched_include_signals.slice(0, 5).map((s, i) => (
                  <li key={i}>
                    <div>{s.signal}</div>
                    {s.evidence && <div className="mt-0.5 border-l-2 border-line pl-2 text-xs text-slate">“{s.evidence}”</div>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {mode === "main" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            disabled={pending || !sug}
            onClick={() => run(() => confirmType(contractId, suggested, false))}
            className="rounded-md bg-ink px-5 py-3 font-medium text-white hover:bg-ink-soft disabled:opacity-50"
          >
            {pending ? "검토 시작하는 중…" : "이 유형이 맞아요 · 리스크 검토 시작"}
          </button>
          <button disabled={pending} onClick={() => setMode("other")} className="rounded-md border border-line bg-white px-4 py-3 text-sm hover:bg-paper">
            다른 유형이에요
          </button>
          <button disabled={pending} onClick={() => setMode("new")} className="rounded-md px-4 py-3 text-sm text-slate hover:text-ink hover:underline">
            목록에 없는 새 유형이에요
          </button>
        </div>
      )}

      {mode === "other" && (
        <div className="space-y-3 rounded-md border border-line p-4">
          <h3 className="font-semibold">어떤 유형인가요?</h3>
          {alternatives.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {alternatives.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPick(k)}
                  className={`rounded-md border px-3 py-2 text-sm ${pick === k ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-paper"}`}
                >
                  {byKey.get(k)?.name} <span className="opacity-70">· AI 2순위 후보</span>
                </button>
              ))}
            </div>
          )}
          <label className="block text-sm">
            <span className="text-slate">전체 유형에서 고르기</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2">
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => (o.group ?? "기타") === g && o.key !== suggested && o.key !== "non_contract")
                    .map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name}
                        {o.hasStandard ? ` (표준 ${o.standardId})` : " (표준 없음)"}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate">{criteria(byKey.get(pick))}</p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={pending || !pick}
              onClick={() => run(() => confirmType(contractId, pick, true))}
              className="rounded-md bg-ink px-5 py-2.5 font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? "검토 시작하는 중…" : "이 유형으로 리스크 검토 시작"}
            </button>
            <button onClick={() => setMode("main")} className="px-3 text-sm text-slate hover:text-ink">
              취소
            </button>
          </div>
        </div>
      )}

      {mode === "new" && (
        <div className="space-y-3 rounded-md border border-line p-4">
          <h3 className="font-semibold">새 유형 등록</h3>
          <p className="text-sm text-slate">어댑트 표준이 아직 없는 유형으로 등록하고, 전 표준 공통 기준으로 검토합니다. 등록한 유형은 표준계약서 메뉴에 &lsquo;표준 제정 필요&rsquo;로 표시됩니다.</p>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="유형 이름 (예: 베트남 PR 대행 계약)" className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          <input value={newDef} onChange={(e) => setNewDef(e.target.value)} placeholder="어떤 계약인지 한 줄 설명 (선택)" className="w-full rounded-md border border-line px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={pending || !newName.trim()}
              onClick={() => run(() => registerNewType(contractId, newName, newDef))}
              className="rounded-md bg-ink px-5 py-2.5 font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? "등록하는 중…" : "새 유형으로 등록하고 검토 시작"}
            </button>
            <button onClick={() => setMode("main")} className="px-3 text-sm text-slate hover:text-ink">
              취소
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p role="alert" className="rounded-md bg-redline-tint px-3 py-2 text-sm text-redline">
          {msg}
        </p>
      )}
    </div>
  );
}
