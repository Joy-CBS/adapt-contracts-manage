"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-medium">화면을 불러오지 못했습니다</h1>
      <p className="text-neutral-600">
        DB가 아직 연결되지 않았거나 데이터가 적재되지 않았을 수 있습니다. 데이터 적재 화면에서 DB 연결 상태를 확인하세요.
      </p>
      <div className="flex gap-3">
        <Link href="/admin" className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
          데이터 적재 화면으로
        </Link>
        <button onClick={reset} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
          다시 시도
        </button>
      </div>
    </div>
  );
}
