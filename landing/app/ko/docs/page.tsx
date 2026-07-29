import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import { A, B, Bullet, Bullets, C, Callout, DocsLink, P, PageHeader, Section } from "@/components/docs/prose";
import { CONTACT_EMAIL, GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 소개 (#143). 영어판(`app/docs/page.tsx`)과 **같은 슬러그·같은 구조**이고 산문만 한국어다.
 * 코드·식별자·엔드포인트 경로·HTTP 상태·enum 값은 영어로 남긴다 — 콘솔과 응답에 그 문자열이 그대로
 * 나오므로 번역하면 독자가 찾을 수 없게 된다.
 */
export default function DocsIntroPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="what-it-is" title="어떤 서비스인가">
        <P>
          reputation·pool 은 서로 대체 가능한 리소스 풀 — 프록시, 계정, 세션 — 을 위한 호스티드 평판
          API 입니다. 보유한 리소스를 등록해 두고, 필요할 때마다 풀에 하나를 요청하고, 다 쓴 뒤에 무슨 일이
          있었는지 보고합니다. 그 대가로 풀은 계속 실패하는 리소스를 더 이상 내주지 않고, 쿨다운 동안
          빼 두고, 다시 건강해 보이면 조심스럽게 복귀시키며, 그 판단을 하나하나 기록합니다.
        </P>
        <P>
          이 루프가 제품 표면 전부입니다. 늘 쓰게 되는 호출이 세 개 — <C>Register</C>, <C>Acquire</C>,{" "}
          <C>Report</C> — 이고, 그 주변의 나머지(키, 풀 상태, 감사 로그, 사용량)를 위한 REST 컨트롤플레인이
          있습니다.
        </P>
      </Section>

      <Section id="when-to-use" title="언제 쓰면 좋은가">
        <P>
          신호는 단순합니다. 다음에 <B>어떤</B> 리소스를 쓸지, 그리고 어떤 리소스를 <B>언제 그만 쓸지</B>{" "}
          결정하는 코드를 이미 갖고 있거나 곧 쓰게 될 상황이면 해당됩니다. 그 코드는 늘 같은 방향으로
          자랍니다 — 쿨다운 맵이 생기고, 그다음 차단 목록이 생기고, 엔드포인트별 예외가 붙고, 마지막엔
          &quot;왜 이게 빠졌는지&quot; 보는 화면이 필요해집니다.
        </P>
        <Bullets>
          <Bullet>
            <B>스크래핑·데이터 수집 인프라</B> — 프록시 풀을 돌려 쓰는데, 태워 버린 프록시가 요란하게
            실패하는 대신 수집 결과를 조용히 망치는 경우.
          </Bullet>
          <Bullet>
            <B>계정 기반 자동화</B> — 계정 하나가 밴이나 rate limit 을 맞았을 때, 그 계정만 로테이션에서
            빼고 나머지는 그대로 돌려야 하는 경우.
          </Bullet>
          <Bullet>
            <B>목적지별로 건강 상태가 갈리는 모든 풀</B> — 같은 리소스가 한 대상에는 멀쩡하고 다른 대상에는
            타 버릴 수 있습니다. 이 구분이 모델의 핵심입니다.{" "}
            <DocsLink slug="concepts" locale={LOCALE}>
              핵심 개념
            </DocsLink>
            을 보세요.
          </Bullet>
        </Bullets>
        <P>
          반대로 풀에 리소스가 하나뿐이거나, 리소스가 서로 대체 가능하지 않거나, 관측된 결과가 아니라 요청
          페이로드를 보고 라우팅을 결정해야 한다면 맞지 않습니다. 풀은 여러분이 보고한 것만 알고 있습니다.
        </P>
      </Section>

      <Section id="two-planes" title="두 개의 평면, 두 개의 자격증명">
        <P>
          서비스는 트래픽 성격으로 나뉘어 있고, 이 구분이 중요한 이유는 두 쪽의 인증 방식이 다르다는 점입니다.
        </P>
        <Bullets>
          <Bullet>
            <B>데이터플레인 (gRPC).</B> <C>ReputationAdvisor</C> 서비스의 <C>Register</C>, <C>Acquire</C>,{" "}
            <C>Report</C>, <C>Renew</C>, <C>Release</C>, <C>SubscribeEvents</C>. 워커가 호출하는 핫 패스입니다.{" "}
            <C>x-api-key</C> 메타데이터 헤더의 API 키로 인증합니다.
          </Bullet>
          <Bullet>
            <B>컨트롤플레인 (REST).</B> <C>/api/**</C> — 풀 상태 조회, 감사 로그 조회, 사용량 조회, API 키
            관리. 대시보드가 올라타 있는 면이고 여러분의 운영 스크립트가 두드리는 면입니다.{" "}
            <C>Authorization: Bearer</C> 헤더의 관리자 JWT 로 인증합니다.
          </Bullet>
        </Bullets>
        <P>
          둘 다 이 문서에 있습니다.{" "}
          <DocsLink slug="quickstart" locale={LOCALE}>
            퀵스타트
          </DocsLink>
          는 데이터플레인 루프를 따라가고,{" "}
          <DocsLink slug="api" locale={LOCALE}>
            REST API 레퍼런스
          </DocsLink>
          는 컨트롤플레인을 다루며,{" "}
          <DocsLink slug="authentication" locale={LOCALE}>
            인증
          </DocsLink>
          은 어느 자격증명이 어디에 속하는지 설명합니다.
        </P>
        <Callout tone="warn" title="지금 인터넷에서 닿는 것은 컨트롤플레인뿐입니다">
          <P>
            gRPC 데이터플레인은 모든 배포에서 loopback 에만 바인딩돼 있고, 공개 리버스 프록시는 대시보드와{" "}
            <C>/api</C> 만 앞단에서 받습니다. 그래서 지금 호스티드로 제공되는 것은 대시보드와 REST
            컨트롤플레인이며, <C>Register</C>/<C>Acquire</C>/<C>Report</C> 루프를 돌리려면 스택을 직접
            띄우게 됩니다 —{" "}
            <DocsLink slug="quickstart" locale={LOCALE}>
              퀵스타트
            </DocsLink>
            가 그 과정을 끝까지 안내합니다. 어느 쪽이든 같은 코드입니다. 왜 포트가 닫혀 있고 열리면 무엇이
            바뀌는지도 그 문서에 적어 두었습니다.
          </P>
        </Callout>
      </Section>

      <Section id="open-core" title="호스티드 API 와 오픈소스 엔진">
        <P>
          판단 엔진은 오픈소스입니다. 점수 계산, 네 가지 상태와 그 사이의 전이, 쿨다운 곡선, 리스 펜싱,
          선택 전략이 모두 Apache-2.0 으로 공개된{" "}
          <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A> 에 있고, 이 서비스는 그것을 fork 하지 않고
          퍼블리시된 의존성으로 소비합니다.{" "}
          <DocsLink slug="concepts" locale={LOCALE}>
            핵심 개념
          </DocsLink>
          이 동작에 대해 말하는 모든 문장은 소스로 확인할 수 있고, 자체 호스팅으로 재현할 수 있습니다.
        </P>
        <P>호스티드 서비스가 더하는 것은 엔진 주변 전부입니다.</P>
        <Bullets>
          <Bullet>멀티테넌트 격리 — 테넌트마다 자기 풀, 자기 감사 로그, 자기 이벤트 스트림.</Bullet>
          <Bullet>API 키 — 발급, 해시 저장, 교체, 즉시 폐기.</Bullet>
          <Bullet>조회 가능한 영구 감사 로그, 그리고 평판 점수 시계열.</Bullet>
          <Bullet>사용량 측정, 대시보드, 알림, 그리고 이걸 실제로 돌리는 일.</Bullet>
        </Bullets>
        <Callout title="라이선스가 아니라 신뢰의 문제입니다">
          <P>
            여러분의 프록시를 한 시간 동안 뺄지 말지 결정하는 그 부분이, 여러분이 직접 감사할 수 있는
            부분입니다. 쿨다운 곡선에 동의하지 않는다면 그 곡선이 정확히 무엇인지 읽고, 엔진 레포에 이슈를
            열거나, 직접 돌릴 수 있습니다. 어느 쪽 버그를 어디에 알리는지는{" "}
            <DocsLink slug="faq" locale={LOCALE}>
              자주 묻는 질문
            </DocsLink>
            에 있습니다.
          </P>
        </Callout>
      </Section>

      <Section id="next" title="다음에 읽을 것">
        <Bullets>
          <Bullet>
            <DocsLink slug="quickstart" locale={LOCALE}>
              퀵스타트
            </DocsLink>{" "}
            — 키 발급부터 첫 <C>Report</C> 까지, curl·Java·TypeScript 예제와 함께.
          </Bullet>
          <Bullet>
            <DocsLink slug="concepts" locale={LOCALE}>
              핵심 개념
            </DocsLink>{" "}
            — 모델 자체: 리소스, 컨텍스트, 셀, 상태.
          </Bullet>
          <Bullet>
            <DocsLink slug="api" locale={LOCALE}>
              REST API 레퍼런스
            </DocsLink>{" "}
            — 컨트롤플레인의 모든 엔드포인트와 각각의 에러.
          </Bullet>
        </Bullets>
        <P>
          이용 신청은 아직 사람이 직접 처리합니다 — 자동 가입은 없고, 지금 온보딩으로 받게 되는 것은
          대시보드와 컨트롤플레인의 테넌트이며 gRPC 엔드포인트가 아닙니다.{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          로 메일을 주시면 테넌트와 첫 키를 만들어 드립니다.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}
