"use client";

import { useState } from "react";

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload() {
    if (!file) {
      setError("업로드할 파일을 먼저 선택하세요.");
      return;
    }
    setState("running");
    setMessage("");
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", body: file });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? res.statusText);
      setState("done");
      setMessage(`적재 완료: 카테고리 ${j.categories}, 표준안 ${j.templates}, 계약서 ${j.contracts}, 검토 ${j.reviews}`);
    } catch (e) {
      setState("error");
      setMessage(String(e));
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-medium">데이터 적재</h1>
        <p className="mt-2 text-neutral-600">
          로컬에서 만든 분석 결과 묶음(<code className="rounded bg-neutral-100 px-1">data/seed-bundle.json.gz</code>)을 올리면 이 사이트의 DB에
          적재합니다. 기존 계약서 분석 결과는 새 묶음으로 교체됩니다.
        </p>
      </div>
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
        <input
          type="file"
          accept=".gz,.json"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
          }}
          className="block w-full text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={upload}
          disabled={state === "running"}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {state === "running" ? "적재 중… (최대 1분)" : "업로드하고 적재"}
        </button>
        {message && <p className={`text-sm ${state === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</p>}
      </div>
    </div>
  );
}
