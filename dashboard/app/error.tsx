"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";
import { getErrorMessages, localeFromDocument } from "@/components/error-messages";
import { buttonClass, Button } from "@/components/ui/button";
import { LANDING_ORIGIN } from "@/lib/site";

/**
 * 라우트 세그먼트 런타임 에러 경계 (#134). 이 파일이 없으면 렌더 중 예외 하나에 Next 기본 에러 화면이
 * 뜨고, 사용자에게는 되돌아갈 방법이 남지 않는다.
 *
 * `"use client"` 는 선택이 아니라 요구사항이다 — 에러 경계는 React 클래스 컴포넌트로 구현되고
 * Next 가 이 파일을 그 경계의 fallback 으로 쓴다. `reset()` 도 클라이언트에서만 의미가 있다.
 *
 * ## reset() 을 노출하는 이유
 * 대시보드 화면 대부분은 폴링/네트워크에 의존한다(`lib/use-poll.ts`). 백엔드가 잠깐 흔들려 던진 예외는
 * 새로고침 없이 세그먼트만 다시 렌더하면 그대로 복구되는 경우가 많다. `reset()` 은 전체 리로드와 달리
 * 스크롤·상위 상태를 유지하므로 사용자가 하던 일을 잃지 않는다.
 *
 * ## digest 를 보여주는 이유
 * 서버에서 난 에러의 실제 메시지는 프로덕션에서 클라이언트로 오지 않는다(스택·내부 경로 유출 방지).
 * 대신 Next 가 붙이는 `digest` 가 서버 로그의 같은 항목을 가리킨다 — 이걸 화면에 남겨야 사용자가
 * "뭔가 안 돼요" 대신 식별자를 들고 올 수 있다. `error.message` 는 표시하지 않는다.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 브라우저 콘솔에도 남긴다. 화면에는 digest 만 노출하므로, 개발자가 F12 로 원본을 볼 통로가 필요하다.
  useEffect(() => {
    console.error(error);
  }, [error]);

  const locale = localeFromDocument();
  const messages = getErrorMessages(locale);

  return (
    <ErrorScreen
      locale={locale}
      code="500"
      title={messages.runtime.title}
      description={messages.runtime.description}
      actions={
        <>
          <Button onClick={reset}>{messages.actions.retry}</Button>
          {/* 404 와 같은 이유로 apex 절대 URL 이다 — `not-found.tsx` 의 홈 링크 주석 참고. */}
          <a href={LANDING_ORIGIN} className={buttonClass("ghost")}>
            {messages.actions.home}
          </a>
        </>
      }
      note={error.digest ? `${messages.digest}: ${error.digest}` : undefined}
    />
  );
}
