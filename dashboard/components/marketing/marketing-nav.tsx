"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClass } from "@/components/ui/button";
import { Brand } from "./logo";
import { GITHUB_REPO_URL, GITHUB_STARS } from "./constants";

/**
 * GitHub 배지 — [옥토캣] GitHub · open source [★금색]. 옥토캣은 currentColor(ink),
 * 별은 항상 금색(#F5B301) 채움(확정 시안과 동일). 스타 수는 값이 있을 때만 노출.
 */
function GitHubPill() {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="hidden items-center gap-2 rounded-[8px] border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] font-semibold text-muted hover:text-ink sm:inline-flex"
    >
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ink" aria-hidden="true">
        <path
          d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.2 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.72-4.04-1.6-4.04-1.6-.55-1.38-1.34-1.75-1.34-1.75-1.1-.74.08-.73.08-.73 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.77.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.84 0-1.29.47-2.35 1.24-3.18-.13-.3-.54-1.52.11-3.16 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.29-1.53 3.3-1.21 3.3-1.21.65 1.64.24 2.86.12 3.16.77.83 1.24 1.89 1.24 3.18 0 4.54-2.81 5.53-5.49 5.83.43.36.81 1.09.81 2.2 0 1.59-.01 2.87-.01 3.26 0 .31.21.68.83.56A11.79 11.79 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z"
          fill="currentColor"
        />
      </svg>
      GitHub
      {GITHUB_STARS != null ? (
        <span className="tnum flex items-center gap-1 font-mono text-xs text-muted">
          <span aria-hidden="true">★</span>
          {GITHUB_STARS.toLocaleString("en-US")}
        </span>
      ) : (
        <span className="hidden font-mono text-xs text-muted lg:inline">open source</span>
      )}
      <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden="true">
        <path
          d="M12 2.4l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.9l-5.8 3.05 1.1-6.45-4.7-4.6 6.5-.95z"
          fill="#F5B301"
          stroke="#E0A100"
          strokeWidth="1"
        />
      </svg>
    </a>
  );
}

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#docs", label: "Docs" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-6 px-6">
        <Link href="/" aria-label="reputation·pool home">
          <Brand />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm font-medium text-muted hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <GitHubPill />
          <ThemeToggle />
          <Link href="/login" className="hidden text-sm font-medium text-muted hover:text-ink sm:inline">
            Sign in
          </Link>
          <Link
            href="#contact"
            className={buttonClass("primary", "inline-flex items-center justify-center text-accent-ink")}
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
