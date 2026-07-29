import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import {
  A,
  B,
  Bullet,
  Bullets,
  C,
  Callout,
  Cell,
  DocsLink,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { CONTACT_EMAIL, GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "faq";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 FAQ (#143). 영어판의 "이 문서는 한국어로 볼 수 있나요?" 항목은 이 PR 로 사실이 아니게 됐으므로
 * 양쪽 페이지에서 함께 고쳐 두었다 — 문서가 자기 자신에 대해 틀린 말을 하는 것이 가장 나쁜 종류의 낙후다.
 */
export default function DocsFaqPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="limits" title="한도">
        <SubHeading>리소스와 셀을 얼마나 가질 수 있나요?</SubHeading>
        <P>
          모든 테넌트의 풀이 하나의 공유 프로세스 안에 상주하므로, 상한은{" "}
          <B>테넌트별 쿼터가 아니라 서비스 전체 예산</B>입니다. 기본값은 모든 테넌트를 합쳐 등록 리소스
          100,000 개, 평판 셀 500,000 개입니다. 이건 의도된 설계입니다 — 활발한 테넌트 하나가 예산 전체를 혼자
          쓸 수도 있고, 여러 테넌트가 등장하는 대로 동적으로 나눠 씁니다. 테넌트별 고정 상한을 두면 경쟁자가
          없는 시간에도 혼자 있는 테넌트를 조르게 됩니다.
        </P>
        <P>
          예산은 영속 상태를 <B>늘리는</B> 호출에서만 확인합니다. 풀이 본 적 없는 리소스에 대한{" "}
          <C>Register</C>, 또는 셀이 아직 없는 <C>(resource, context)</C> 조합에 대한 <C>Report</C> 가
          그렇습니다. 이 경우 <C>RESOURCE_EXHAUSTED</C> 로 거절됩니다. 그 밖의 모든 것 — 획득, 기존 셀에 대한
          보고, 조회 — 은 계속 동작합니다. 닫히는 게이트가 아니라 안전한 방향의 천장입니다.
        </P>
        <Callout tone="warn" title="이 숫자는 측정된 용량이 아니라 아직 검증되지 않은 가설입니다">
          <P>
            100,000 / 500,000 을 뒷받침하는 프로덕션 부하 테스트는 아직 없습니다. 예산을 켜 두기 위해 존재하는
            값이고, 리소스당 실제 메모리 사용량이 관측되면 조정할 대상입니다. 그 규모에 가까운 계획이 있다면
            프로덕션에서 천장을 발견하는 대신 먼저 이야기해 주세요.
          </P>
        </Callout>

        <SubHeading>요청 rate limit 이 있나요?</SubHeading>
        <P>
          데이터플레인에는 지금 없습니다 — 테넌트별 RPC 쿼터가 없습니다. 존재하는 유일한 제한은{" "}
          <C>POST /api/auth/login</C> 에 걸린 출처 IP 기준 제한입니다. 15 분 안에 5 번 실패하면 그 IP 를 15 분
          동안 막고(<C>429</C> 와 <C>Retry-After</C>), 그 뒤를 전역 초당 상한이 받칩니다. 조회 엔드포인트는
          대신 자기 입력을 스스로 자릅니다. <C>score-history?hours=</C> 는 <C>[1, 720]</C> 로,{" "}
          <C>events?limit=</C> 은 <C>[1, 500]</C> 로 잘리므로 한 번의 호출로 무한 스캔을 만들 수 없습니다.
        </P>

        <SubHeading>리소스 하나에 컨텍스트는 몇 개가 적당한가요?</SubHeading>
        <P>
          그 리소스를 독립적으로 태울 수 있는 대상의 수만큼 — 보통 목적지마다 하나입니다. 서로 다른{" "}
          <C>(resource, context)</C> 조합 하나가 위 예산에서 셀 하나이므로, 요청마다 파생되는 컨텍스트(요청 id,
          타임스탬프)는 예산을 소진시키면서 쓸모 있는 이력도 남기지 못합니다.{" "}
          <DocsLink slug="concepts" locale={LOCALE}>
            핵심 개념
          </DocsLink>
          을 보세요.
        </P>
      </Section>

      <Section id="retention" title="보존 기간">
        <Table head={["데이터", "보존", "설명"]}>
          <Row>
            <Cell>평판 상태(셀, 차단 목록, 등록 정보)</Cell>
            <Cell>무기한</Cell>
            <Cell>
              실시간 상태이고 PostgreSQL 에 체크포인트로 저장돼 재시작 때 복원됩니다. 시계열이 아닙니다.
            </Cell>
          </Row>
          <Row>
            <Cell>
              점수 표본(<C>score-history</C>)
            </Cell>
            <Cell>7 일</Cell>
            <Cell>살아 있는 셀마다 1 분에 한 번 샘플링하고, 오래된 표본은 매시간 정리합니다.</Cell>
          </Row>
          <Row>
            <Cell>
              감사 이벤트(<C>GET /api/events</C>)
            </Cell>
            <Cell>기본은 무기한</Cell>
            <Cell>
              기간 기반 정리는 opt-in 이고 설정하지 않으면 꺼져 있으므로, 별도로 요청하지 않는 한 로그가
              온전합니다.
            </Cell>
          </Row>
          <Row>
            <Cell>사용량 측정값</Cell>
            <Cell>정리하지 않음</Cell>
            <Cell>
              일별 행입니다. <C>GET /api/usage</C> 는 최근 30 일과 이번 달 합계를 돌려줍니다.
            </Cell>
          </Row>
          <Row>
            <Cell>리스</Cell>
            <Cell>TTL 만료 또는 반납까지</Cell>
            <Cell>
              런타임 조정 장치일 뿐이고 영구 스냅샷에 포함되지 않으므로, 재시작 후에는 아무것도 잡혀 있지
              않습니다.
            </Cell>
          </Row>
        </Table>
        <P>
          컴플라이언스 사유로 특정 감사 보존 기간이 필요하다면 그것은 API 설정이 아니라 배포 설정입니다 —
          말씀해 주시면 해당 테넌트에 맞춰 설정해 드립니다.
        </P>
      </Section>

      <Section id="self-host" title="자체 호스팅이냐 호스티드냐">
        <Callout tone="warn" title="지금은 완전한 선택지가 아닙니다 — 데이터플레인은 어느 쪽이든 자체 호스팅입니다">
          <P>
            gRPC 포트는 모든 배포에서 loopback 에 바인딩돼 있고 공개 리버스 프록시는 대시보드와 <C>/api</C> 만
            앞단에서 받으므로, <C>Acquire</C> 와 <C>Report</C> 를 보낼 호스티드 주소가 없습니다. 지금 호스팅이
            덮는 범위는 컨트롤플레인과 그 위에 올라간 모든 것입니다. 아래 비교는 두 선택지가 지향하는 모습이고,
            지금 실제로 도는 것은{" "}
            <DocsLink slug="quickstart" locale={LOCALE}>
              퀵스타트
            </DocsLink>
            입니다.
          </P>
        </Callout>
        <P>
          엔진은 Apache-2.0 오픈소스로 <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A> 에 있습니다.
          점수 계산, 네 상태와 전이, 쿨다운 곡선, 리스 펜싱, 선택 전략, gRPC 계약, PostgreSQL 영속화 어댑터가
          모두 여기 있습니다. 자체 호스팅은 정당한 선택이고, 이 서비스는 엔진을 fork 하지 않고 퍼블리시된
          아티팩트를 소비합니다 — 여러분이 돌리게 될 것이 같은 코드입니다.
        </P>
        <Table head={["", "자체 호스팅 엔진", "호스티드 API"]}>
          <Row>
            <Cell>
              <B>판단 로직</B>
            </Cell>
            <Cell>있음 — 동일</Cell>
            <Cell>있음 — 동일</Cell>
          </Row>
          <Row>
            <Cell>
              <B>운영 대상</B>
            </Cell>
            <Cell>프로세스, PostgreSQL, 업그레이드, 백업</Cell>
            <Cell>없음</Cell>
          </Row>
          <Row>
            <Cell>
              <B>멀티테넌트 격리</B>
            </Cell>
            <Cell>직접 만들어야 함</Cell>
            <Cell>내장 — 테넌트마다 풀·감사 로그·이벤트 스트림</Cell>
          </Row>
          <Row>
            <Cell>
              <B>API 키</B>
            </Cell>
            <Cell>직접 만들어야 함</Cell>
            <Cell>발급, 해시 저장, 교체, 즉시 폐기</Cell>
          </Row>
          <Row>
            <Cell>
              <B>대시보드, 감사 조회, 점수 곡선</B>
            </Cell>
            <Cell>없음 — 업스트림의 감사 로그는 쓰기 전용</Cell>
            <Cell>포함</Cell>
          </Row>
          <Row>
            <Cell>
              <B>사용량 측정과 알림</B>
            </Cell>
            <Cell>직접 만들어야 함</Cell>
            <Cell>포함</Cell>
          </Row>
        </Table>
        <P>
          거친 기준: 동작만 필요하고 이미 상태 있는 서비스를 운영하고 있다면 자체 호스팅. 동작에 더해 키,
          테넌시, 조회 가능한 감사 로그, 그리고 대신 대기하는 사람까지 필요하다면 호스티드 API 입니다.
        </P>

        <SubHeading>둘 사이를 옮겨갈 수 있나요?</SubHeading>
        <P>
          평판 모델은 어느 쪽이든 같고 gRPC 계약은 우리 것이 아니라 엔진의 것이므로, 클라이언트 코드는 주소와
          인증 헤더만 바꾸면 그대로 옮겨집니다. 평판 상태는 지금 이전되지 않습니다 — 풀은 실제 트래픽으로 다시
          예열되고, 대부분의 워크로드에서 며칠이 아니라 몇 시간 걸립니다.
        </P>
      </Section>

      <Section id="bugs" title="버그는 어디에 알리나요?">
        <P>
          어느 쪽이 잘못됐는지에 따라 다르고, 그 구분은{" "}
          <DocsLink slug="" locale={LOCALE}>
            소개
          </DocsLink>
          에서 설명한 것과 같습니다.
        </P>
        <SubHeading>엔진 동작 → 공개 레포</SubHeading>
        <P>
          엔진이 무엇을 판단하는지에 관한 문제라면{" "}
          <A href={`${GITHUB_REPO_URL}/issues`}>PreAgile/reputation-pool</A> 에 올려 주세요.
        </P>
        <Bullets>
          <Bullet>일어나면 안 되는데 일어나는(또는 일어나야 하는데 안 일어나는) 상태 전이</Bullet>
          <Bullet>쿨다운 곡선, 점수 벌점, 지수 백오프</Bullet>
          <Bullet>선택 — 어느 후보가 뽑히는지, 가중치가 어떻게 동작하는지</Bullet>
          <Bullet>리스 의미 — 펜싱 토큰, 만료, 갱신과 반납</Bullet>
          <Bullet>
            <C>advisor.proto</C> 의 gRPC 계약과 메시지 모양
          </Bullet>
        </Bullets>
        <P>
          이런 것들이 업스트림에 속하는 이유는 수정이 모두가 돌리는 코드에 들어가야 하고, 그 논의를 공개적으로
          하는 편이 낫기 때문입니다. 호스티드에만 적용하는 패치는 여러분이 감사할 수 있어야 할 바로 그 로직을
          fork 하는 것입니다.
        </P>
        <SubHeading>호스팅 동작 → 저희에게</SubHeading>
        <P>
          서비스 운영에 관한 문제라면{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          로 알려 주세요.
        </P>
        <Bullets>
          <Bullet>인증, API 키, JWT, 로그인 흐름</Bullet>
          <Bullet>테넌트 격리, 또는 보이면 안 되는 것이 보이는 경우</Bullet>
          <Bullet>REST 컨트롤플레인, 대시보드, 사용량 측정, 감사 로그 조회 쪽</Bullet>
          <Bullet>가용성, 지연, 배포</Bullet>
        </Bullets>
        <Callout tone="warn" title="보안 문제는 공개 이슈로 올리지 마세요">
          <P>
            테넌트 격리, 키 취급, 인증에 닿는 것은 어느 쪽이든 먼저 이메일로 보내 주세요. 무엇을 했고, 무엇을
            봤고, 대략 언제였는지를 적어 주시고, API 키 원문은 넣지 마세요.
          </P>
        </Callout>
        <P>
          어느 쪽인지 확실하지 않다면 이메일을 주세요. 엔진 버그를 잘못 보내면 메일 한 번 전달하는 비용이지만,
          말하지 않고 두면 그보다 비쌉니다.
        </P>
      </Section>

      <Section id="misc" title="그 외">
        <SubHeading>왜 여러분 호스트의 gRPC 데이터플레인에 닿지 않나요?</SubHeading>
        <P>
          공개하지 않았기 때문입니다. compose 가 <C>9093</C> 포트를 <C>127.0.0.1</C> 에 바인딩하고, 리버스
          프록시에는 gRPC 경로도 그것을 위한 TLS 종단도 없습니다. 이 바인딩은 구조를 지탱하는 부분이기도
          합니다 — 로그인 제한이 <C>X-Forwarded-For</C> 를 신뢰하는 전제가 &quot;프록시를 거치지 않으면 앱에
          닿을 수 없다&quot; 이므로, 데이터플레인을 여는 것은 포트 변경이 아니라 그 방어를 다시 설계하는
          일입니다. 그때까지는{" "}
          <DocsLink slug="quickstart" locale={LOCALE}>
            퀵스타트
          </DocsLink>
          가 여러분이 띄운 스택에서 루프를 돌리고, 클라이언트 코드는 주소와 채널 자격증명만 빼면 동일합니다.
        </P>

        <SubHeading>Acquire 와 Report 의 REST 버전이 있나요?</SubHeading>
        <P>
          지금은 없습니다. 데이터플레인은 gRPC 전용이고 컨트롤플레인이 REST 입니다. HTTP 데이터플레인이 도입을
          막는 부분이라면 알려 주세요. 원칙적인 거부가 아니라 알려진 온보딩 비용입니다.
        </P>

        <SubHeading>Prometheus 메트릭을 스크레이프할 수 있나요?</SubHeading>
        <P>
          서비스가 Prometheus 엔드포인트를 노출하지만 공개 인터넷으로 라우팅하지 않습니다 — 신뢰 경계가
          네트워크이므로 클러스터 안의 스크레이퍼만 닿습니다. 고객이 직접 메트릭에 접근하는 기능은 아직
          없습니다. 지원되는 조회 경로는 대시보드와 <C>GET /api/usage</C> 입니다.
        </P>

        <SubHeading>온라인 자동 가입이 있나요?</SubHeading>
        <P>
          없습니다. 지금은 테넌트를 사람이 직접 온보딩하며, 그것도 의도적입니다 — 풀마다 누군가 지켜보는
          상태에서 세팅합니다. 어떤 워크로드인지 한 줄만 적어{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          로 보내 주세요.
        </P>

        <SubHeading>이 문서는 영어로도 볼 수 있나요?</SubHeading>
        <P>
          네. 문서 전체가 영어와 한국어로 있고, 어느 페이지에서든 상단 언어 스위처로 <B>같은 페이지</B>의 다른
          언어판으로 이동할 수 있습니다. 문서 URL 은 방문자 언어에 따라 자동으로 바뀌지 않습니다 — 공유된
          링크는 보낸 사람이 본 언어로 열려야 하기 때문입니다. 코드·식별자·엔드포인트 경로·JSON 키는 두
          언어에서 동일하게 영어로 둡니다.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}
