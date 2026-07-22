import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export type EmptyStateTone = "default" | "error";

type EmptyStateProps = {
  /** 상단 아이콘. 생략하면 tone 에 맞는 기본 아이콘(빈 트레이 / 경고 삼각형)을 쓴다. */
  icon?: ReactNode;
  /** 굵은 한 줄 제목("~가 없습니다" / "불러오지 못했습니다"). */
  title: string;
  /** 보조 설명(선택). 왜 비었는지·다음 행동을 가볍게 안내. */
  description?: ReactNode;
  /** 선택적 CTA. 에러의 "다시 시도", 빈 목록의 "새로 만들기" 등. */
  action?: { label: string; onClick: () => void };
  /** default(중립 회색) | error(block 강조). 기본 default. */
  tone?: EmptyStateTone;
  className?: string;
};

/** tone=default 기본 아이콘 — 빈 트레이(수집된 항목 없음). */
function InboxIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13" />
      <path d="M3 13h5l1.2 2.4a1 1 0 0 0 .9.6h3.8a1 1 0 0 0 .9-.6L16 13h5v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
    </svg>
  );
}

/** tone=error 기본 아이콘 — 경고 삼각형. */
function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5l9 15.5H3l9-15.5z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * 목록 빈 상태·에러 상태의 재사용 블록(아이콘 + 제목 + 설명 + 선택 CTA). Card 를 감싸지 않으므로
 * 호출부가 상황에 맞게 <Card> 안이나 테이블 <td> 안에 넣는다. tone=error 는 block 색으로 강조하고,
 * action 을 주면 "다시 시도" 같은 복구 버튼을 노출한다. 은은한 fade-in(모션 감소 시 자동 무력화).
 */
export function EmptyState({ icon, title, description, action, tone = "default", className }: EmptyStateProps) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={cn(
        "motion-safe:animate-[rp-fade-in_var(--motion-base)_var(--ease-out)] flex flex-col items-center justify-center px-6 py-10 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 flex size-12 items-center justify-center rounded-full",
          isError ? "bg-block/12 text-block-ink" : "bg-surface-2 text-muted",
        )}
      >
        {icon ?? (isError ? <AlertIcon /> : <InboxIcon />)}
      </div>
      <div className="text-sm font-bold text-ink">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && (
        <Button variant="ghost" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
