"use client";

import { useEffect, useRef } from "react";

/**
 * fn을 ms 간격으로 호출하되, 탭이 백그라운드(`document.hidden`)면 건너뛴다 — 보이지 않는 화면을
 * 폴링하는 낭비를 없앤다. 탭이 다시 보이면 즉시 한 번 당겨 최신 상태로 맞춘다. {@code enabled=false}면
 * 폴링을 멈춘다(수동 일시정지 등). 최신 fn을 ref로 잡아, fn이 매 렌더 새로 만들어져도 간격을
 * 재설정하지 않는다.
 *
 * <p>SSE 대신 이 방식을 쓰는 이유: 운영 콘솔은 관리자 소수가 보고 원천 데이터도 초~분 단위라, 서버 push의
 * 연결·확장 부담을 질 이유가 없다. 보이는 동안만 가볍게 당기는 것으로 충분하다.
 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (!document.hidden) saved.current();
    };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
