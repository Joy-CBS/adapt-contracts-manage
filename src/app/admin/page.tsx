"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type DbStatus = { mode: "neon" | "pglite" | "missing"; envVar?: string; reachable: boolean | null; error?: string };

export default function AdminPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [db, setDb] = useState<DbStatus | null>(null);

  useEffect(() => {
    fetch("/api/admin/seed")
      .then((r) => r.json())
      .then(setDb)
      .catch(() => setDb(null));
  }, []);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(gz|json)$/i.test(f.name)) {
      setError("seed-bundle.json.gz 파일을 선택하세요.");
      return;
    }
    setFile(f);
    setError("");
    setState("idle");
    setMessage("");
  }

  async function upload() {
    if (!file) {
      setError("먼저 위 영역을 눌러 파일을 선택하세요.");
      return;
    }
    setState("running");
    setMessage("");
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", body: file });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; categories?: number; templates?: number; contracts?: number; reviews?: number } = {};
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`서버 응답 오류 (${res.status}) ${text.slice(0, 200)}`);
      }
      if (!res.ok || !j.ok) throw new Error(j.error ?? `${res.status} ${res.statusText}`);
      setState("done");
      setMessage(`적재 완료: 카테고리 ${j.categories}, 표준안 ${j.templates}, 계약서 ${j.contracts}, 검토 ${j.reviews}`);
    } catch (e) {
      setState("error");
      setMessage(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-medium">데이터 적재</h1>
        <p className="mt-2 text-neutral-600">
          분석 결과 묶음 파일을 올리면 이 사이트의 DB에 적재합니다. 기존 계약서 분석 결과는 새 묶음으로 교체됩니다.
        </p>
      </div>

      <DbBadge db={db} />

      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="text-sm text-neutral-700">
          <span className="font-medium">1.</span> 파일 선택
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? "border-neutral-900 bg-neutral-50" : file ? "border-emerald-300 bg-emerald-50/50" : "border-neutral-300 hover:border-neutral-500"
          }`}
        >
          {file ? (
            <>
              <span className="font-medium text-emerald-800">{file.name}</span>
              <span className="text-xs text-neutral-500">{(file.size / 1e6).toFixed(1)}MB · 다른 파일로 바꾸려면 다시 누르세요</span>
            </>
          ) : (
            <>
              <span className="font-medium">여기를 눌러 파일 선택</span>
              <span className="text-xs text-neutral-500">또는 파일을 이 영역으로 끌어다 놓기</span>
              <span className="mt-2 text-xs text-neutral-400">위치: ~/Dev/adapt-contracts-manage/data/seed-bundle.json.gz</span>
            </>
          )}
        </button>
        <input ref={inputRef} type="file" accept=".gz,.json" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

        <div className="text-sm text-neutral-700">
          <span className="font-medium">2.</span> 적재
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={upload}
          disabled={!file || state === "running"}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {state === "running" ? "적재 중… (최대 1분)" : "업로드하고 적재"}
        </button>
        {message && <p className={`text-sm ${state === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</p>}
        {state === "done" && (
          <Link href="/" className="inline-block text-sm text-neutral-600 underline">
            첫 화면으로 가기 →
          </Link>
        )}
      </div>
    </div>
  );
}

function DbBadge({ db }: { db: DbStatus | null }) {
  if (!db) return <p className="text-sm text-neutral-400">DB 연결 상태 확인 중…</p>;
  if (db.mode === "missing")
    return (
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
        DB가 연결되어 있지 않습니다. Vercel 프로젝트의 <b>Storage</b> 탭에서 Neon DB를 이 프로젝트에 <b>Connect</b> 한 뒤{" "}
        <b>Deployments → Redeploy</b> 하세요.
      </div>
    );
  if (db.reachable === false)
    return (
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
        DB에 접속하지 못했습니다 ({db.envVar ?? db.mode}): {db.error}
      </div>
    );
  return (
    <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
      DB 연결 정상 · {db.mode === "neon" ? `Neon (${db.envVar})` : "로컬 내장 DB"}
    </div>
  );
}
