/**
 * 컨트롤 플레인 API 클라이언트. same-origin `/api/*`(dev는 next rewrite로 8083 프록시)에 Bearer JWT를
 * 붙여 호출하고, 백엔드의 RFC 7807 ProblemDetail 에러를 {@link ApiError}로 변환한다.
 */

const TOKEN_KEY = "rp_admin_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ApiOptions {
  /** 401을 만나면 토큰을 지우고 /login으로 보낸다. 로그인 호출에서는 false. */
  redirectOn401?: boolean;
}

export async function api<T>(path: string, init?: RequestInit, opts: ApiOptions = {}): Promise<T> {
  const { redirectOn401 = true } = opts;
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    if (redirectOn401 && typeof window !== "undefined") {
      setToken(null);
      window.location.href = "/login";
    }
    throw new ApiError(401, "인증이 필요합니다");
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.title;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detail ?? `요청 실패 (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
