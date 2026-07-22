import { notFound } from "next/navigation";
import { EventsMock } from "@/components/marketing/mock/events-mock";

/** 마케팅 스크린샷 캡처 전용(영어 목업). 프로덕션 비노출. */
export default function PreviewEvents() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EventsMock />;
}
