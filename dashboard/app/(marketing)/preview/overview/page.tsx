import { notFound } from "next/navigation";
import { OverviewMock } from "@/components/marketing/mock/overview-mock";

/**
 * 마케팅 스크린샷 캡처 전용(영어 목업). dev 서버에서만 렌더하고 프로덕션 번들에는 노출하지 않는다
 * (scripts/marketing-shots.ts 가 dev 서버의 이 경로를 방문해 PNG 로 저장). 실제 제품 화면이 아니다.
 */
export default function PreviewOverview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OverviewMock />;
}
