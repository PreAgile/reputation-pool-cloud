"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? "아이디 또는 비밀번호가 올바르지 않습니다." : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent";

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-[16px] border border-line bg-surface p-7 shadow-[0_2px_10px_rgba(0,0,0,0.05)]"
      >
        <div className="text-lg font-extrabold tracking-tight">reputation-pool 콘솔</div>
        <div className="mb-6 mt-1 text-sm text-muted">관리자 로그인</div>

        <label className="mb-1 block text-xs font-semibold text-muted">아이디</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className={`${field} mb-4`}
        />
        <label className="mb-1 block text-xs font-semibold text-muted">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className={`${field} mb-2`}
        />
        {error && <div className="mb-1 text-sm text-block">{error}</div>}
        <Button type="submit" disabled={busy} className="mt-4 w-full">
          {busy ? "확인 중…" : "로그인"}
        </Button>
      </form>
    </div>
  );
}
