"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getTenantId } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { ApiKeySummary, IssuedApiKey } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** ISO-8601 → 한국 로케일 표기. 파싱 실패 시 원문 그대로. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/** 활성/폐기됨 상태 배지. StatusBadge는 리소스 enum 전용이라 여기서 별도 정의. */
function KeyStatusBadge({ revoked }: { revoked: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold",
        revoked ? "text-muted-ink bg-muted/12" : "text-ok-ink bg-ok/12",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {revoked ? "폐기됨" : "활성"}
    </span>
  );
}

/** 활성 먼저(폐기됨 뒤로), 그 안에서 최신 생성순. */
function sortKeys(keys: ApiKeySummary[]): ApiKeySummary[] {
  return [...keys].sort((a, b) => {
    const ar = a.revokedAt ? 1 : 0;
    const br = b.revokedAt ? 1 : 0;
    if (ar !== br) return ar - br;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export default function KeysPage() {
  const [tenantId, setTenantId] = useState<string | null | undefined>(undefined);
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 발급 폼
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [issuing, setIssuing] = useState(false);

  // 발급 직후 1회 노출 박스
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  // 폐기 확인 중인 키 id
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    setTenantId(getTenantId());
  }, []);

  const load = useCallback(async (tid: string) => {
    setError(null);
    try {
      const list = await api<ApiKeySummary[]>(`/tenants/${tid}/api-keys`);
      setKeys(sortKeys(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    }
  }, []);

  useEffect(() => {
    if (tenantId) void load(tenantId);
  }, [tenantId, load]);

  async function onIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const trimmed = label.trim();
      const body = trimmed ? JSON.stringify({ label: trimmed }) : undefined;
      const key = await api<IssuedApiKey>(`/tenants/${tenantId}/api-keys`, {
        method: "POST",
        body,
      });
      setIssued(key);
      setCopied(false);
      setFormOpen(false);
      setLabel("");
      await load(tenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "키 발급에 실패했습니다");
    } finally {
      setIssuing(false);
    }
  }

  async function onRevoke(id: string) {
    if (!tenantId || revokingId) return;
    setRevokingId(id);
    setError(null);
    try {
      await api<void>(`/tenants/${tenantId}/api-keys/${id}`, { method: "DELETE" });
      setConfirmId(null);
      await load(tenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "키 폐기에 실패했습니다");
    } finally {
      setRevokingId(null);
    }
  }

  async function onCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent";

  // 테넌트 정보 없음(토큰에 tenant 클레임 부재/디코드 실패)
  if (tenantId === null) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-xl font-extrabold tracking-tight">API 키 관리</h1>
        <Card className="p-4 text-sm text-muted">
          테넌트 정보를 확인할 수 없습니다.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">API 키 관리</h1>
        {!formOpen && <Button onClick={() => setFormOpen(true)}>새 키 발급</Button>}
      </div>

      {/* 발급 폼(인라인) */}
      {formOpen && (
        <Card className="mb-4 p-4">
          <form onSubmit={onIssue} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-muted">
                라벨 <span className="font-normal">(선택)</span>
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 프로덕션 수집기"
                autoFocus
                className={field}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={issuing}>
                {issuing ? "발급 중…" : "발급"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={issuing}
                onClick={() => {
                  setFormOpen(false);
                  setLabel("");
                }}
              >
                취소
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 발급 직후 rawToken 1회 노출 박스 */}
      {issued && (
        <Card className="mb-4 border-accent bg-accent-soft p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">키가 발급되었습니다</div>
              <div className="mt-0.5 text-xs font-semibold text-accent">
                지금만 볼 수 있습니다. 닫으면 다시 확인할 수 없습니다.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="shrink-0 rounded-[8px] px-2 py-1 text-xs font-bold text-muted hover:bg-surface"
              aria-label="닫기"
            >
              닫기
            </button>
          </div>
          {issued.label && <div className="mb-2 text-xs text-muted">라벨 · {issued.label}</div>}
          <div className="flex items-center gap-2">
            <code className="tnum flex-1 overflow-x-auto rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink">
              {issued.rawToken}
            </code>
            <Button type="button" onClick={onCopy} className="shrink-0">
              {copied ? "복사됨" : "복사"}
            </Button>
          </div>
        </Card>
      )}

      {error && <Card className="mb-4 p-4 text-sm text-block">요청 실패 · {error}</Card>}

      {!error && keys === null && <div className="text-sm text-muted">불러오는 중…</div>}

      {keys !== null && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-bold">라벨</th>
                  <th className="px-4 py-2.5 font-bold">prefix</th>
                  <th className="px-4 py-2.5 font-bold">생성일</th>
                  <th className="px-4 py-2.5 font-bold">상태</th>
                  <th className="px-4 py-2.5 text-right font-bold">작업</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const revoked = Boolean(k.revokedAt);
                  return (
                    <tr key={k.id} className="border-t border-line">
                      <td className="px-4 py-2.5 text-ink">
                        {k.label ?? <span className="text-muted">(라벨 없음)</span>}
                      </td>
                      <td className="tnum px-4 py-2.5 font-mono text-muted">{k.prefix}…</td>
                      <td className="px-4 py-2.5 text-muted">{fmtDate(k.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <KeyStatusBadge revoked={revoked} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {revoked ? (
                          <span className="text-muted">—</span>
                        ) : confirmId === k.id ? (
                          <span className="inline-flex items-center justify-end gap-2">
                            <span className="text-xs text-muted">폐기할까요?</span>
                            <button
                              type="button"
                              disabled={revokingId === k.id}
                              onClick={() => onRevoke(k.id)}
                              className="rounded-[8px] px-2 py-1 text-xs font-bold text-block-ink hover:bg-block/12 disabled:opacity-50"
                            >
                              {revokingId === k.id ? "폐기 중…" : "확인"}
                            </button>
                            <button
                              type="button"
                              disabled={revokingId === k.id}
                              onClick={() => setConfirmId(null)}
                              className="rounded-[8px] px-2 py-1 text-xs font-bold text-muted hover:bg-surface-2 disabled:opacity-50"
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(k.id)}
                            className="rounded-[8px] px-2 py-1 text-xs font-bold text-block-ink hover:bg-block/12"
                          >
                            폐기
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {keys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
                      발급된 API 키가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
