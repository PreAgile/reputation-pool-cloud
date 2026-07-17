"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Tenant } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** ISO-8601 → 한국 로케일 표기. 파싱 실패 시 원문 그대로. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * 테넌트 상태 배지. status enum이 백엔드 확정 전이라 알려진 값만 기능색으로 칠하고
 * 그 외는 중립(muted)으로 폴백한다. ACTIVE는 ok, SUSPENDED/차단 계열은 block.
 */
function TenantStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "ACTIVE"
      ? "text-ok bg-ok/12"
      : s === "SUSPENDED" || s === "BLOCKED" || s === "DISABLED"
        ? "text-block bg-block/12"
        : "text-muted bg-muted/12";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/** 최신 생성순. */
function sortTenants(list: Tenant[]): Tenant[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 생성 폼
  const [formOpen, setFormOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api<Tenant[]>("/tenants");
      setTenants(sortTenants(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setFormOpen(false);
    setId("");
    setName("");
    setFormError(null);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) {
      setFormError("id와 name을 모두 입력하세요.");
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await api<Tenant>("/tenants", {
        method: "POST",
        body: JSON.stringify({ id: trimmedId, name: trimmedName }),
      });
      resetForm();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "테넌트 생성에 실패했습니다");
    } finally {
      setCreating(false);
    }
  }

  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">관리자</h1>
        {!formOpen && <Button onClick={() => setFormOpen(true)}>새 테넌트</Button>}
      </div>

      {/* 헬스: actuator health는 /actuator/health에 있고 dev의 /api rewrite로는 닿지 않음.
          라이브 호출을 넣지 않고 후속 안내만 표시한다. */}
      <Card className="mb-4 p-4">
        <div className="text-sm font-bold text-ink">시스템 헬스</div>
        <p className="mt-1 text-sm text-muted">
          헬스 지표는 후속입니다 (별도 프록시 필요). Spring actuator는{" "}
          <code className="font-mono text-xs text-ink">/actuator/health</code>에 있고 현재 dev
          프록시는 <code className="font-mono text-xs text-ink">/api</code>만 전달합니다.
        </p>
        {/* TODO(#12): actuator 헬스용 rewrite 추가 후 연결 */}
      </Card>

      {/* 생성 폼(인라인) */}
      {formOpen && (
        <Card className="mb-4 p-4">
          <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-muted">id</label>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="예: acme"
                autoFocus
                className={cn(field, "font-mono")}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-muted">name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: Acme Corp"
                className={field}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={creating}>
                {creating ? "생성 중…" : "생성"}
              </Button>
              <Button type="button" variant="ghost" disabled={creating} onClick={resetForm}>
                취소
              </Button>
            </div>
          </form>
          {formError && <div className="mt-3 text-sm text-block">요청 실패 · {formError}</div>}
        </Card>
      )}

      {error && <Card className="mb-4 p-4 text-sm text-block">요청 실패 · {error}</Card>}

      {!error && tenants === null && <div className="text-sm text-muted">불러오는 중…</div>}

      {tenants !== null && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-bold">id</th>
                  <th className="px-4 py-2.5 font-bold">name</th>
                  <th className="px-4 py-2.5 font-bold">상태</th>
                  <th className="px-4 py-2.5 font-bold">생성일</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="tnum px-4 py-2.5 font-mono text-ink">{t.id}</td>
                    <td className="px-4 py-2.5 text-ink">{t.name}</td>
                    <td className="px-4 py-2.5">
                      <TenantStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted">{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted">
                      등록된 테넌트가 없습니다.
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
