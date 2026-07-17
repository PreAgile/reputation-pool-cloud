"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import type { LoginResponse } from "./types";

interface AuthContextValue {
  /** 초기 토큰 확인이 끝났는지(하이드레이션 후). */
  ready: boolean;
  authed: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
    setReady(true);
  }, []);

  async function login(username: string, password: string) {
    // 로그인 실패(401)는 여기서 잡아 화면에 표시해야 하므로 자동 리다이렉트를 끈다.
    const res = await api<LoginResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) },
      { redirectOn401: false },
    );
    setToken(res.token);
    setAuthed(true);
  }

  function logout() {
    setToken(null);
    setAuthed(false);
    if (typeof window !== "undefined") window.location.href = "/login";
  }

  return <AuthContext.Provider value={{ ready, authed, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * 현재 토큰(JWT)에서 테넌트 ID를 추출한다.
 * LoginResponse에는 tenant가 없으므로 JWT payload(두 번째 세그먼트)를 base64url 디코드해
 * `tenant` 클레임을 읽는다(`sub`는 admin username). 실패하면 null.
 */
export function getTenantId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url → base64 변환 후 UTF-8 안전 디코드.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const claims = JSON.parse(json) as { tenant?: unknown };
    return typeof claims.tenant === "string" ? claims.tenant : null;
  } catch {
    return null;
  }
}
