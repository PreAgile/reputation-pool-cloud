"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

/** 보호 영역: 토큰 없으면 /login으로. 초기 토큰 확인 전엔 아무것도 안 그린다. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, authed } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authed) router.replace("/login");
  }, [ready, authed, router]);

  if (!ready || !authed) return null;
  return <AppShell>{children}</AppShell>;
}
