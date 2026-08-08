"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import type { LoginResponse } from "./types";

interface AuthContextValue {
  /** 초기 토큰 확인이 끝났는지(하이드레이션 후). */
  ready: boolean;
  authed: boolean;
  /**
   * 현재 세션이 열람 전용(scope=viewer)인지. 백엔드가 GET 외 메서드를 403으로 막으므로 이 값은
   * 권한이 아니라 표시용이다 — 눌러도 실패할 버튼을 미리 잠가 "고장난 화면"으로 보이지 않게 한다.
   */
  readOnly: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
    // 새로고침 후에도 유지돼야 하므로 로그인 응답이 아니라 토큰 자체에서 읽는다(테넌트와 같은 방식).
    setReadOnly(isReadOnlyToken());
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
    // "admin 이 아니면 읽기 전용" — viewer 를 골라내는 게 아니라 admin 만 통과시킨다. scope 가 비었거나
    // 앞으로 생길 제3의 값이어도 쓰기 UI 가 열리지 않게, 서버의 판정 방향과 같은 쪽으로 실패시킨다.
    setReadOnly(res.scope !== "admin");
  }

  function logout() {
    setToken(null);
    setAuthed(false);
    setReadOnly(false);
    if (typeof window !== "undefined") window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ ready, authed, readOnly, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * 현재 세션이 열람 전용인지 — 쓰기 UI를 렌더할지 결정하는 용도.
 *
 * useAuth()와 달리 AuthProvider 밖에서도 throw 하지 않는다. 페이지 컴포넌트는 프로바이더 없이 단독
 * 렌더되는 단위 테스트 대상이기도 한데, 그때 화면이 죽는 대신 토큰에서 직접 같은 답을 읽는다.
 * 이 값은 표시용이고 실제 권한은 서버가 요청마다 판정하므로, 이 폴백이 권한을 넓히지 않는다.
 */
export function useReadOnly(): boolean {
  const ctx = useContext(AuthContext);
  if (!ctx) return isReadOnlyToken();
  // 하이드레이션 직후 한 틱 동안 ready 는 false 이고 readOnly 는 아직 초기값(false)이다. 그 틈에 쓰기 UI를
  // 그리면 저장된 viewer 토큰으로 새로고침한 화면이 잠깐 어드민처럼 보인다 — 확정 전까지는 잠가 둔다.
  return ctx.ready ? ctx.readOnly : true;
}

/** 현재 토큰(JWT)의 payload 클레임. 토큰이 없거나 형식이 깨졌으면 null. */
function readClaims(): { tenant?: unknown; scope?: unknown } | null {
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
    return JSON.parse(json) as { tenant?: unknown; scope?: unknown };
  } catch {
    return null;
  }
}

/**
 * 현재 토큰(JWT)에서 테넌트 ID를 추출한다.
 * LoginResponse에는 tenant가 없으므로 JWT payload의 `tenant` 클레임을 읽는다(`sub`는 로그인 이름).
 * 실패하면 null.
 */
export function getTenantId(): string | null {
  const claims = readClaims();
  return claims && typeof claims.tenant === "string" ? claims.tenant : null;
}

/**
 * 현재 토큰이 열람 전용(scope=viewer)인지. scope 클레임이 명시적으로 "admin" 일 때만 쓰기 가능으로 보고,
 * 없거나 알 수 없는 값이면 열람 전용으로 취급한다 — 표시 계층도 백엔드와 같은 fail-closed 방향이어야
 * 스코프 클레임이 없던 옛 토큰이 쓰기 UI를 열어 주는 일이 없다.
 */
export function isReadOnlyToken(): boolean {
  const claims = readClaims();
  if (!claims) return false; // 비로그인 상태는 읽기 전용이 아니라 "세션 없음" — 로그인 화면이 처리한다.
  return claims.scope !== "admin";
}
