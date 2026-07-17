import { cn } from "@/lib/cn";

/**
 * 미니 스파크라인: recentWindow(성공=true/실패=false)를 작은 막대 열로 렌더한다.
 * 성공은 기능색 ok, 실패는 block 톤. 빈 배열이면 옅은 placeholder("—").
 * 순수 CSS(div 막대) — recharts 불필요, 다크모드 토큰 대응.
 */
export function Sparkline({ flags, className }: { flags: boolean[]; className?: string }) {
  if (!flags || flags.length === 0) {
    return (
      <span className={cn("text-muted/60", className)} title="최근 판정 기록 없음" aria-label="최근 판정 기록 없음">
        —
      </span>
    );
  }

  const success = flags.filter(Boolean).length;
  const title = `최근 ${flags.length}회 중 ${success}회 성공`;

  return (
    <span
      className={cn("inline-flex items-end gap-0.5 align-middle", className)}
      title={title}
      role="img"
      aria-label={title}
    >
      {flags.map((ok, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "w-1 rounded-[1px]",
            ok ? "h-3 bg-ok/70" : "h-1.5 bg-block/70",
          )}
        />
      ))}
    </span>
  );
}
