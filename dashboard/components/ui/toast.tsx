"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

/** 성공(초록/ok) · 오류(빨강/block) 두 종류. 브랜드 accent와는 섞지 않는다(기능색만). */
export type ToastVariant = "success" | "error";

type ToastItem = { id: number; variant: ToastVariant; message: string };

type ToastContextValue = {
  /** 임의 variant 로 토스트를 띄운다(기본: success). */
  toast: (message: string, variant?: ToastVariant) => void;
  /** 성공 토스트(aria-live polite). */
  success: (message: string) => void;
  /** 오류 토스트(role=alert, aria-live assertive). */
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** 자동 소멸까지의 시간(ms). 파괴적 동작 결과가 사라지기 전 충분히 읽히도록 넉넉히. */
export const TOAST_DURATION_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, variant, message }]);
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // 언마운트 시 남은 타이머 정리(테스트/HMR 누수 방지).
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (message, variant = "success") => push(message, variant),
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 는 ToastProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

/** 화면 우하단 고정 스택. 컨테이너는 클릭을 막지 않고(pointer-events-none) 개별 토스트만 상호작용. */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const isError = item.variant === "error";
  return (
    <div
      // 성공은 polite/status, 오류는 assertive/alert — 삽입 시 스크린리더가 읽는다.
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex min-w-[15rem] max-w-sm items-start gap-3 rounded-[12px] border bg-surface px-4 py-3 shadow-md",
        isError ? "border-block/40" : "border-ok/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", isError ? "bg-block" : "bg-ok")}
      />
      <p className="flex-1 text-sm font-semibold text-ink">{item.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="알림 닫기"
        className="-mr-1 shrink-0 rounded-[8px] px-1.5 py-0.5 text-xs font-bold text-muted hover:bg-surface-2 hover:text-ink"
      >
        닫기
      </button>
    </div>
  );
}
