import { cn } from "@/lib/cn";

/**
 * 로딩 자리표시자. surface-2 위에서 은은하게 맥동(animate-pulse)하며,
 * prefers-reduced-motion 이면 motion-reduce 로 애니메이션을 끈다.
 * 순수 장식이라 스크린리더에는 숨긴다(aria-hidden). 로딩 상태 안내는 부모의 라이브 영역이 맡는다.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-[8px] bg-surface-2 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
