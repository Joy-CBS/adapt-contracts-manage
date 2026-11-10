"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("계약서 파일을 먼저 선택해 주세요.");
    if (file.size > 4 * 1024 * 1024) return setError("4MB 이하 파일만 올릴 수 있습니다.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("note", note);
    const res = await fetch("/api/requests", { method: "POST", body: fd }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !body?.id) {
      setBusy(false);
      return setError(body?.error ?? "접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    router.push(`/requests/${body.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition ${
          drag ? "border-ink bg-white" : file ? "border-comply bg-comply-tint/40" : "border-line bg-white hover:border-ink/40"
        }`}
      >
        <input ref={input} type="file" accept=".pdf,.doc,.docx,.hwp,.hwpx,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <span className="text-base font-semibold">{file.name}</span>
            <span className="mt-1 text-sm text-slate">{(file.size / 1024 / 1024).toFixed(1)}MB · 다른 파일을 고르려면 다시 누르세요</span>
          </>
        ) : (
          <>
            <span className="text-base font-semibold">여기에 계약서 파일을 끌어다 놓거나 눌러서 고르세요</span>
            <span className="mt-1 text-sm text-slate">PDF · Word · 한글 · 이미지, 4MB 이하</span>
          </>
        )}
      </div>
      <label className="block">
        <span className="text-sm font-medium">요청 메모 (선택)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="예: 상대방이 보낸 수정본입니다. 이번 주 금요일까지 회신 필요."
          className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-redline-tint px-3 py-2 text-sm text-redline">
          {error}
        </p>
      )}
      <button disabled={busy} className="w-full rounded-md bg-ink px-5 py-3 font-medium text-white hover:bg-ink-soft disabled:opacity-60 sm:w-auto">
        {busy ? "올리는 중…" : "검토 요청하기"}
      </button>
    </form>
  );
}
