"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveArchiveType, confirmType } from "@/app/actions";

type Option = { key: string; name: string; group: string | null; hasStandard: boolean; standardId: string | null };

/** 보관함 계약서의 유형 확인·변경(바꾸면 새 유형 기준으로 다시 검토) */
export function ArchiveTypeFix({ contractId, current, options, needsCheck }: { contractId: string; current: string | null; options: Option[]; needsCheck: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(options.find((o) => o.key !== current)?.key ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const groups = [...new Set(options.map((o) => o.group ?? "기타"))];
  const run = (f: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await f();
      setMsg(r.ok ? null : r.message);
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {needsCheck && (
          <button disabled={pending} onClick={() => run(() => approveArchiveType(contractId))} className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-soft">
            분류가 맞아요
          </button>
        )}
        <button disabled={pending} onClick={() => setOpen((v) => !v)} className={needsCheck ? "rounded-md border border-line bg-white px-3.5 py-2 text-sm hover:bg-paper" : "text-sm text-slate hover:text-ink hover:underline"}>
          {needsCheck ? "다른 유형으로 바꾸기" : "유형이 틀렸나요?"}
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-md border border-line bg-white px-2.5 py-2 text-sm" aria-label="바꿀 유형">
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {options
                  .filter((o) => (o.group ?? "기타") === g && o.key !== current && o.key !== "non_contract")
                  .map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                      {o.hasStandard ? ` (표준 ${o.standardId})` : " (표준 없음)"}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button disabled={pending || !pick} onClick={() => run(() => confirmType(contractId, pick, true))} className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "바꾸는 중…" : "바꾸고 다시 검토"}
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-redline">{msg}</p>}
    </div>
  );
}
