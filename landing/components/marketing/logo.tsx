import { cn } from "@/lib/cn";

/**
 * 리플(ripple) 마크 — nav·footer 공용 브랜드 로고. 블루 그라디언트 타일 위 흰 SVG.
 * 확정 시안(landing-design-en.html)의 마크를 그대로 재현한다. currentColor 미사용(항상 흰 획).
 */
export function RippleLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid place-items-center rounded-[7px] bg-gradient-to-br from-accent to-[#4aa0ff] shadow-[0_1px_2px_rgba(15,25,50,0.28),inset_0_1px_0_rgba(255,255,255,0.25)]",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[60%]">
        <path
          d="M12 3.4a8.6 8.6 0 1 1-8.6 8.6"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M12 7.9a4.1 4.1 0 1 1-4.1 4.1"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          opacity=".82"
        />
        <circle cx="12" cy="12" r="2.15" fill="#fff" />
      </svg>
    </span>
  );
}

/** 브랜드 워드마크(로고 + "reputation·pool"). */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-base font-extrabold tracking-tight text-ink", className)}>
      <RippleLogo className="size-[23px]" />
      reputation·pool
    </span>
  );
}
