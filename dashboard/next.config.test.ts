import { describe, it, expect } from "vitest";
import nextConfig from "./next.config";
import { LANDING_ORIGIN } from "@/lib/site";

/**
 * 마케팅 표면 이전(#15/#16)의 리다이렉트 계약.
 *
 * 이 테스트가 있는 이유: 옛 랜딩·문서 URL(`/`·`/ko`·`/docs*`)은 이 앱에서 화면이 **삭제된** 경로다.
 * 즉 리다이렉트가 하나라도 빠지면 그 URL 은 조용히 404 가 되고, 이미 색인·공유된 주소라서 그 손실이
 * 배포 후에 티가 나지 않는다("아무도 안 들어오는 페이지"와 구분이 안 된다). 라우트가 사라진 자리에는
 * 반드시 이 표가 있어야 한다는 사실을 여기서 잠근다.
 */

/** `redirects()` 는 async 라 테스트에서 항상 await 해서 목록으로 다룬다. */
const redirects = async () => {
  const list = await nextConfig.redirects!();
  return list.map((r) => ({ source: r.source, destination: r.destination, permanent: r.permanent }));
};

describe("next.config redirects (#15): 이 앱에서 사라진 마케팅 URL 을 apex 랜딩으로 넘긴다", () => {
  it("옛 랜딩·문서 경로 5개가 모두 apex 로 넘어간다 → 삭제된 화면이 404 로 방치되지 않는다", async () => {
    expect(await redirects()).toEqual([
      { source: "/", destination: LANDING_ORIGIN, permanent: true },
      { source: "/ko", destination: `${LANDING_ORIGIN}/ko`, permanent: true },
      { source: "/en", destination: LANDING_ORIGIN, permanent: true },
      { source: "/docs", destination: `${LANDING_ORIGIN}/docs`, permanent: true },
      { source: "/docs/:path*", destination: `${LANDING_ORIGIN}/docs/:path*`, permanent: true },
    ]);
  });

  it("전부 영구 리다이렉트다 → 크롤러가 링크 지분을 apex 로 합친다", async () => {
    expect((await redirects()).every((r) => r.permanent === true)).toBe(true);
  });

  it("대상은 전부 apex 절대 URL 이고 대시보드 자기 호스트로 되돌아가지 않는다 → 리다이렉트 루프가 불가능하다", async () => {
    for (const { destination } of await redirects()) {
      expect(destination.startsWith(LANDING_ORIGIN)).toBe(true);
      expect(destination).not.toContain("app.poolroost.com");
    }
  });

  it("앱 진입점은 리다이렉트 대상이 아니다 → /login·/overview 는 이 호스트에 그대로 남는다", async () => {
    const sources = (await redirects()).map((r) => r.source);

    expect(sources).not.toContain("/login");
    expect(sources).not.toContain("/overview");
  });
});
