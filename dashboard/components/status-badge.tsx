import { cn } from "@/lib/cn";
import type { ResourceState } from "@/lib/types";

/** 상태 = 기능색만. 실제 백엔드 enum(HEALTHY/COOLING/RECOVERING/BLOCKLISTED)에 정확히 매핑. */
// 평판 상태는 영어 도메인 용어가 더 자연스럽다(Cooldown/Recovering 등) — 라벨은 영어로 통일.
const MAP: Record<ResourceState, { label: string; cls: string }> = {
  HEALTHY: { label: "Healthy", cls: "text-ok-ink bg-ok/12" },
  COOLING: { label: "Cooldown", cls: "text-cool-ink bg-cool/12" },
  RECOVERING: { label: "Recovering", cls: "text-recover-ink bg-recover/12" },
  BLOCKLISTED: { label: "Blocked", cls: "text-block-ink bg-block/12" },
};

export function StatusBadge({ state }: { state: ResourceState }) {
  const m = MAP[state] ?? MAP.HEALTHY;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold", m.cls)}>
      <span className="size-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}
