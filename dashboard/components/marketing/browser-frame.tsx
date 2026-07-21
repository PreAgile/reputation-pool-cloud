import { cn } from "@/lib/cn";

/**
 * 스크린샷을 감싸는 가벼운 브라우저 크롬(트래픽 라이트 + 주소줄). 대시보드 토큰만 사용해
 * 랜딩이 제품과 한 브랜드로 보이게 한다. 순수 정적(서버 컴포넌트).
 */
export function BrowserFrame({
  src,
  alt,
  url = "app.reputation-pool.dev",
  className,
  imgClassName,
  priority = false,
}: {
  src: string;
  alt: string;
  url?: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-block/70" />
          <span className="size-2.5 rounded-full bg-cool/70" />
          <span className="size-2.5 rounded-full bg-ok/70" />
        </span>
        <span className="ml-2 hidden flex-1 truncate rounded-md bg-surface px-2.5 py-1 text-center font-mono text-[11px] text-muted sm:block">
          {url}
        </span>
      </div>
      {/* 스크린샷은 정적 자산 — next/image 대신 <img> (자체 호스팅 PNG, 최적화 불필요). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className={cn("block w-full", imgClassName)}
      />
    </figure>
  );
}
