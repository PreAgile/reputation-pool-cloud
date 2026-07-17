import { cn } from "@/lib/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" };

export function Button({ className, variant = "primary", ...props }: Props) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:brightness-95"
      : "border border-line bg-surface-2 text-ink hover:bg-surface";
  return (
    <button
      className={cn(
        "rounded-[10px] px-3.5 py-2 text-sm font-bold transition disabled:opacity-50",
        styles,
        className,
      )}
      {...props}
    />
  );
}
