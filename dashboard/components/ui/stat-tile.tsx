import { cn } from "@/lib/cn";

/** Toss형 KPI 타일: 크고 굵은 숫자 + 작은 라벨. accent면 토스 블루. */
export function StatTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div className={cn("tnum text-[22px] font-extrabold leading-none tracking-tight", accent && "text-accent")}>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
