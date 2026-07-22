import { cn } from "@/lib/cn";

/** 타일 의미색. 값 숫자색 + 좌측 강조 바에 반영한다(상태별 기능색과 정확히 매핑). */
export type StatTone = "default" | "accent" | "ok" | "cool" | "recover" | "block";

const TONE: Record<StatTone, { value: string; bar: string }> = {
  default: { value: "text-ink", bar: "bg-line" },
  accent: { value: "text-accent", bar: "bg-accent" },
  ok: { value: "text-ok-ink", bar: "bg-ok" },
  cool: { value: "text-cool-ink", bar: "bg-cool" },
  recover: { value: "text-recover-ink", bar: "bg-recover" },
  block: { value: "text-block-ink", bar: "bg-block" },
};

/** delta(직전 폴링 대비 증감) 색: 좋아짐=ok, 나빠짐=block, 중립=muted. */
const DELTA_TONE = {
  good: "text-ok-ink",
  bad: "text-block-ink",
  neutral: "text-muted",
} as const;

/**
 * Toss형 KPI 타일: 크고 굵은 숫자 + 작은 라벨. 좌측 세로 강조 바로 의미색을 부여하고,
 * delta 가 주어지면 직전 폴링 대비 증감(▲/▼)을 색과 함께 표시한다.
 * accent 는 tone="accent" 지름길(하위호환).
 */
export function StatTile({
  label,
  value,
  tone = "default",
  accent = false,
  delta,
  deltaTone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  accent?: boolean;
  /** 직전 폴링 대비 증감. 0/미지정이면 표시하지 않는다. */
  delta?: number;
  deltaTone?: keyof typeof DELTA_TONE;
}) {
  const t = TONE[accent ? "accent" : tone];
  const showDelta = typeof delta === "number" && delta !== 0;

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
      <div className="flex items-start justify-between gap-2">
        <div className={cn("tnum text-[22px] font-extrabold leading-none tracking-tight", t.value)}>
          {value}
        </div>
        {showDelta && (
          <span
            className={cn("tnum inline-flex items-center gap-0.5 text-xs font-bold", DELTA_TONE[deltaTone])}
            aria-label={`직전 대비 ${delta > 0 ? "증가" : "감소"} ${Math.abs(delta)}`}
          >
            <span aria-hidden>{delta > 0 ? "▲" : "▼"}</span>
            {Math.abs(delta)}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
