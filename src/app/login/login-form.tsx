"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user.trim() || !password) {
      setError("아이디와 비밀번호를 모두 입력하세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setError(j.error ?? "로그인하지 못했습니다. 잠시 후 다시 시도하세요.");
        setPending(false);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
      setPending(false);
    }
  }

  const input =
    "mt-1.5 block h-11 w-full rounded-md border border-line bg-white px-3 text-base outline-none focus:border-insert focus:ring-2 focus:ring-insert/20";

  return (
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg border border-line bg-white p-5" noValidate>
      <div>
        <label htmlFor="user" className="text-sm font-medium">
          아이디
        </label>
        <input
          id="user"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={user}
          onChange={(e) => {
            setUser(e.target.value);
            setError("");
          }}
          className={input}
          autoFocus
        />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          className={input}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-redline">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-md bg-ink text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-60"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
