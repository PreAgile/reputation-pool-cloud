"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";
import { LOGIN_I18N, type LoginLocale } from "./locale";

/** 로그인 화면 언어 토글 — EN / 한국어. 서버가 Accept-Language 로 고른 기본값을 사용자가 덮어쓸 수 있다. */
function LangToggle({ locale, onChange, label }: { locale: LoginLocale; onChange: (l: LoginLocale) => void; label: string }) {
  const opts: { key: LoginLocale; text: string }[] = [
    { key: "en", text: "EN" },
    { key: "ko", text: "한국어" },
  ];
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-[10px] border border-line p-0.5 text-sm">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={locale === o.key}
          className={cn(
            "rounded-[8px] px-2.5 py-1 font-semibold transition-colors",
            locale === o.key ? "bg-accent-soft text-accent" : "text-muted hover:text-ink",
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function LoginForm({ initialLocale }: { initialLocale: LoginLocale }) {
  const { login } = useAuth();
  const router = useRouter();
  const [locale, setLocale] = useState<LoginLocale>(initialLocale);
  const t = LOGIN_I18N[locale];

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // 아이디만 앞뒤 공백을 제거한다(자동완성 흔한 오인). 비밀번호는 공백도 유효 문자일 수 있어 원문 유지.
      await login(username.trim(), password);
      router.push("/overview");
    } catch (err) {
      if (err instanceof ApiError) {
        // 429(로그인 시도 제한)를 자격증명 오류로 뭉뚱그리지 않는다 — 원인이 다르다.
        setError(err.status === 429 ? t.errThrottled : t.errBadCredentials);
      } else {
        setError(t.errNetwork);
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent";

  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LangToggle locale={locale} onChange={setLocale} label={t.languageLabel} />
        <ThemeToggle />
      </div>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-[16px] border border-line bg-surface p-7 shadow-[0_2px_10px_rgba(0,0,0,0.05)]"
      >
        <div className="text-lg font-extrabold tracking-tight">{t.title}</div>
        <div className="mb-6 mt-1 text-sm text-muted">{t.subtitle}</div>

        <label htmlFor="username" className="mb-1 block text-xs font-semibold text-muted">
          {t.username}
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className={`${field} mb-4`}
        />
        <label htmlFor="password" className="mb-1 block text-xs font-semibold text-muted">
          {t.password}
        </label>
        <div className="relative mb-2">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={`${field} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t.hidePassword : t.showPassword}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[10px] text-muted hover:text-ink"
          >
            {showPassword ? (
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" />
                <circle cx="10" cy="10" r="2.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" />
                <circle cx="10" cy="10" r="2.5" />
                <path d="M3 3l14 14" />
              </svg>
            )}
          </button>
        </div>
        {error && <div className="mb-1 text-sm text-block">{error}</div>}
        <Button type="submit" disabled={busy} className="mt-4 w-full">
          {busy ? t.submitting : t.submit}
        </Button>
      </form>
    </div>
  );
}
