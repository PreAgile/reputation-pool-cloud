import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost";

/**
 * 버튼 스타일 클래스. <button> 뿐 아니라 링크형 CTA(<a>/<Link>)도 같은 모양을 쓰도록 분리한다
 * (링크 안에 <button> 을 넣으면 nested-interactive a11y 위반이 되므로, 링크엔 이 클래스만 얹는다).
 */
export function buttonClass(variant: ButtonVariant = "primary", className?: string) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:brightness-95"
      : "border border-line bg-surface-2 text-ink hover:bg-surface";
  return cn(
    "rounded-[10px] px-3.5 py-2 text-sm font-bold transition disabled:opacity-50",
    styles,
    className,
  );
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ className, variant = "primary", ...props }: Props) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
