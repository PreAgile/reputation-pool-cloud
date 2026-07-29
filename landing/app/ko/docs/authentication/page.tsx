import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import {
  B,
  Bullet,
  Bullets,
  C,
  Callout,
  Cell,
  CodeBlock,
  DocsLink,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "authentication";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 인증 (#143). 헤더 이름·gRPC 상태 코드·HTTP 상태·엔드포인트 경로·JWT 클레임 이름은 영어로 남긴다 —
 * 전부 실제 요청과 응답에 그대로 나타나는 문자열이다.
 */
export default function DocsAuthenticationPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="two-credentials" title="평면마다 자격증명이 하나씩">
        <Table head={["", "데이터플레인 (gRPC)", "컨트롤플레인 (REST)"]}>
          <Row>
            <Cell>
              <B>자격증명</B>
            </Cell>
            <Cell>API 키</Cell>
            <Cell>관리자 JWT</Cell>
          </Row>
          <Row>
            <Cell>
              <B>전달 방식</B>
            </Cell>
            <Cell>
              <C>x-api-key</C> 메타데이터
            </Cell>
            <Cell>
              <C>Authorization: Bearer …</C>
            </Cell>
          </Row>
          <Row>
            <Cell>
              <B>유효 기간</B>
            </Cell>
            <Cell>폐기할 때까지</Cell>
            <Cell>기본 한 시간</Cell>
          </Row>
          <Row>
            <Cell>
              <B>귀속 대상</B>
            </Cell>
            <Cell>테넌트</Cell>
            <Cell>테넌트에 묶인 관리자 로그인</Cell>
          </Row>
          <Row>
            <Cell>
              <B>쓰는 곳</B>
            </Cell>
            <Cell>여러분의 워커</Cell>
            <Cell>대시보드와 운영 스크립트</Cell>
          </Row>
        </Table>
        <P>
          둘은 서로 대체되지 않습니다. gRPC 서버는 자기 포트에서 자기 인터셉터를 돌리고{" "}
          <C>Authorization</C> 을 아예 보지 않으며, 서블릿 보안 체인은 <C>x-api-key</C> 를 아예 보지 않습니다.
          엉뚱한 쪽을 보내는 것은 아무것도 보내지 않은 것과 구별되지 않습니다.
        </P>
        <Callout tone="warn" title="지금 각 자격증명을 어디에 쓸 수 있는가">
          <P>
            관리자 JWT 는 호스티드 컨트롤플레인에 그대로 통합니다. API 키는 모든 배포에서 loopback 에 바인딩된
            gRPC 포트를 향하므로, 지금은 여러분이 직접 띄운 스택의 호출을 인증합니다 —{" "}
            <DocsLink slug="quickstart" locale={LOCALE}>
              퀵스타트
            </DocsLink>
            를 보세요. 아래의 발급·저장·교체·폐기는 두 경우에 모두 같습니다. 키는 어느 쪽이든 컨트롤플레인에서
            발급됩니다.
          </P>
        </Callout>
      </Section>

      <Section id="api-keys" title="API 키">
        <SubHeading>발급</SubHeading>
        <P>
          키는 테넌트별로 발급하며, 대시보드의 API 키 화면이나{" "}
          <C>POST /api/tenants/&#123;tenantId&#125;/api-keys</C> 를 씁니다. 선택 항목인 <C>label</C> 은 나중에
          키를 구분하기 위한 것입니다(&quot;worker-01&quot;, &quot;staging&quot;) — 자격증명의 일부가
          아닙니다.
        </P>
        <CodeBlock language="json" title="201 Created — the only response that contains rawToken">
          {`{
  "id": "5f1c2b40-…",
  "rawToken": "rp_9Q3xK7bT…",
  "label": "worker-01",
  "prefix": "rp_9Q3xK7bT",
  "createdAt": "2026-07-29T09:12:44Z"
}`}
        </CodeBlock>

        <SubHeading>형식과 저장</SubHeading>
        <P>
          원문 키는 <C>rp_</C> 뒤에 암호학적 RNG 에서 뽑은 256 비트를 base64url 로 인코딩한 문자열입니다.{" "}
          <C>rp_</C> 접두사는 키의 이름공간을 표시하고, 로그나 레포에 실수로 새어 나갔을 때 grep 으로 찾을 수
          있게 해 줍니다.
        </P>
        <P>저장되는 것은 의도적으로 인증에 쓸 수 없는 정보뿐입니다.</P>
        <Bullets>
          <Bullet>
            원문 키의 <B>SHA-256 해시</B> — 조회할 때 보내온 값을 해시해서 해시끼리 비교하므로, 원문은
            평문으로 저장되거나 비교되지 않습니다.
          </Bullet>
          <Bullet>
            <B>표시용 접두사</B>(<C>rp_</C> + 8 자) — 비밀이 아니며, 목록 조회가 보여 주는 유일한 값입니다.
          </Bullet>
          <Bullet>레이블, 생성 시각, 폐기 시각.</Bullet>
        </Bullets>
        <Callout title="왜 비밀번호용 KDF 가 아니라 SHA-256 인가">
          <P>
            bcrypt·argon2 는 <B>엔트로피가 낮은</B> 비밀을 추측하는 비용을 올리기 위해 존재합니다. 여기서 API
            키는 256 비트 난수이므로 해시 속도와 무관하게 무차별 대입이 불가능합니다 — KDF 를 쓰면 모든 gRPC
            호출에 지연만 더하고 얻는 것이 없습니다. 비밀번호와 고엔트로피 토큰은 서로 다른 문제입니다.
          </P>
        </Callout>

        <SubHeading>원문 키는 정확히 한 번만 보여 줍니다</SubHeading>
        <P>
          해시만 남기므로 키 값을 다시 돌려줄 수 있는 동작이 어디에도 없습니다 — API 도, 대시보드도,
          데이터베이스도 못 합니다. 잃어버렸으면 새로 발급하세요. 그래서 키 목록 조회는 구조적으로 안전합니다.
          정당한 관리자에게조차 키 원문을 흘릴 수 없습니다.
        </P>
        <CodeBlock language="json" title="GET …/api-keys — no key material, ever">
          {`[
  {"id":"5f1c2b40-…","label":"worker-01","prefix":"rp_9Q3xK7bT",
   "createdAt":"2026-07-29T09:12:44Z","revokedAt":null},
  {"id":"a08e77c1-…","label":"laptop","prefix":"rp_LmN4pQr8",
   "createdAt":"2026-06-02T11:40:10Z","revokedAt":"2026-07-01T08:00:00Z"}
]`}
        </CodeBlock>

        <SubHeading>키 교체</SubHeading>
        <P>
          &quot;rotate&quot; 동작은 없고, 그건 의도적입니다 — 교체는 곧 발급 후 폐기이고, 그것이 아무것도
          동작하지 않는 구간이 생기지 않는 유일한 순서입니다.
        </P>
        <Bullets>
          <Bullet>새 키를 발급합니다. 이제 두 키가 모두 유효합니다.</Bullet>
          <Bullet>새 키를 워커에 배포하고 트래픽이 그 키로 흐르는지 확인합니다.</Bullet>
          <Bullet>
            기존 키를 <C>id</C> 로 폐기합니다.
          </Bullet>
        </Bullets>
        <P>
          배포 단위마다 레이블이 붙은 키를 따로 주세요. 그러면 워커 하나를 교체하거나 한 머신에서 새어 나간
          키를 폐기해도 나머지가 끊기지 않습니다.
        </P>

        <SubHeading>폐기는 즉시 적용됩니다</SubHeading>
        <P>
          <C>DELETE /api/tenants/&#123;tenantId&#125;/api-keys/&#123;keyId&#125;</C> 는 키에 폐기 시각을
          찍습니다. gRPC 조회는 폐기 시각이 없는 키만 보므로 그 키는 바로 다음 호출부터 통하지 않습니다 —
          기다려야 할 캐시가 없습니다. 이미 폐기된 키나 존재하지 않는 키를 폐기하면 둘 중 어느 쪽인지 밝히지
          않고 <C>404</C> 를 돌려줍니다.
        </P>

        <SubHeading>거절된 호출은 어떻게 보이는가</SubHeading>
        <Table head={["상황", "gRPC 상태", "이유"]}>
          <Row>
            <Cell>키 없음, 모르는 키, 폐기된 키</Cell>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>세 경우가 똑같이 응답됩니다 — 응답은 키의 존재 여부를 절대 알려 주지 않습니다.</Cell>
          </Row>
          <Row>
            <Cell>정지되거나 삭제된 테넌트의 키</Cell>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>
              조회는 활성 테넌트까지 함께 요구하므로, 키가 폐기되지 않았어도 동결된 테넌트의 트래픽은 멈춥니다.
            </Cell>
          </Row>
          <Row>
            <Cell>키 저장소에 닿을 수 없음</Cell>
            <Cell>
              <C>UNAVAILABLE</C>
            </Cell>
            <Cell>
              장애가 잘못된 자격증명으로 위장해서는 안 됩니다. <C>UNAVAILABLE</C> 은 진단 가능하고 재시도할 수
              있는 답이고, 거짓 <C>UNAUTHENTICATED</C> 는 존재하지 않는 키 문제를 찾아 헤매게 만듭니다.
            </Cell>
          </Row>
        </Table>
      </Section>

      <Section id="jwt" title="대시보드 세션 (관리자 JWT)">
        <P>
          컨트롤플레인은 토큰 전용이고 상태를 갖지 않습니다. 서버 세션도, 로그인 쿠키도 없으므로 CSRF 토큰도
          없습니다 — 크로스사이트 요청이 얹혀 갈 암묵적 자격증명이 애초에 존재하지 않습니다. 자격증명을 한 번
          JWT 로 바꾸고, 그 토큰을 요청마다 붙입니다.
        </P>
        <CodeBlock language="bash" title="POST /api/auth/login — the one public control-plane endpoint">
          {`curl -sS -X POST "https://$RP_HOST/api/auth/login" \\
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"…"}'

# {"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}`}
        </CodeBlock>
        <P>토큰은 서비스가 HS256 으로 서명하고, 의미 있는 클레임이 두 개 있습니다.</P>
        <Bullets>
          <Bullet>
            <C>sub</C> — 관리자 사용자명.
          </Bullet>
          <Bullet>
            <C>tenant</C> — <B>범위가 있는 모든 조회가 평가되는 테넌트 경계입니다.</B> 로그인 시점에 서버가
            정하며, 쿼리 파라미터·헤더·요청 본문에서 절대 가져오지 않습니다.
          </Bullet>
        </Bullets>
        <P>
          마지막 항목이 테넌시 규칙 전부입니다. 풀 조회, 이벤트 피드, 사용량이 모두 토큰 자신의{" "}
          <C>tenant</C> 클레임으로 범위가 정해지므로, 다른 테넌트를 가리킬 수 있는 요청 형태가 없습니다.{" "}
          <C>tenant</C> 클레임이 없는 토큰은 기본값으로 채워지지 않고 거절됩니다.
        </P>

        <SubHeading>다른 테넌트를 향한 요청은 조용히, 닫히는 방향으로 실패합니다</SubHeading>
        <P>
          키 관리 엔드포인트는 경로에 <C>tenantId</C> 를 받습니다. 그것이 토큰이 묶인 테넌트가 아니면 답은{" "}
          <C>403 forbidden</C> 이고, 이 검사는 &quot;이 테넌트가 존재하는가&quot; 검사보다 <B>먼저</B>{" "}
          돕니다 — 403 과 404 의 차이로 어떤 테넌트가 존재하는지 알아낼 수 없습니다.
        </P>

        <SubHeading>로그인은 출처 IP 별로 제한됩니다</SubHeading>
        <P>
          v1 에는 관리자 계정이 하나뿐이므로 실패가 쌓였을 때 &quot;계정&quot;을 잠그는 것은 스스로 만드는
          장애입니다. 그래서 제한 대상은 <B>출처 IP</B> 입니다. 15 분 안에 5 번 실패하면 그 IP 를 15 분 동안
          막고, <C>429</C> 와 <C>Retry-After</C> 헤더로 답합니다. 로그인이 성공하면 그 IP 의 카운터가
          초기화되고, 여러 주소로 흩뿌린 시도에 대비한 전역 초당 상한이 그 뒤를 받칩니다.
        </P>
        <Callout tone="warn" title="로그인 실패 응답은 일부러 아무것도 알려 주지 않습니다">
          <P>
            잘못된 사용자명, 잘못된 비밀번호, 설정되지 않은 콘솔이 모두 그냥 <C>401 invalid credentials</C>{" "}
            입니다. 자격증명 비교도 상수 시간으로 하므로 응답 시간으로 어느 필드가 맞았는지 알 수 없습니다.
            이유에 따라 분기하는 재시도 로직을 만들지 마세요 — 이유는 하나뿐입니다.
          </P>
        </Callout>

        <SubHeading>만료</SubHeading>
        <P>
          토큰은 기본 한 시간 유효하고 refresh 엔드포인트는 없습니다. 만료되면 모든 호출이 <C>401</C> 로
          답하므로 다시 로그인합니다. 한 시간보다 오래 도는 스크립트는 토큰이 실행 내내 유효하다고 가정하지 말고{" "}
          <C>401</C> 에서 재로그인하도록 만드세요. 대시보드가 바로 그렇게 동작하며, 로그인 화면으로 되돌립니다.
        </P>
      </Section>

      <Section id="checklist" title="운영 체크리스트">
        <Bullets>
          <Bullet>배포 단위마다 레이블 붙은 API 키 하나 — 전체가 공유하는 키 하나가 아닙니다.</Bullet>
          <Bullet>키는 발급 응답에서 바로 비밀 저장소로 넣습니다. 그 뒤에는 아무것도 되읽을 수 없습니다.</Bullet>
          <Bullet>교체는 발급을 먼저, 폐기를 나중에 — 그래야 빈 구간이 없습니다.</Bullet>
          <Bullet>
            키를 URL 에 절대 넣지 마세요. 키가 있어야 할 곳은 <C>x-api-key</C> 메타데이터 헤더이고, 그건 접근
            로그나 referer 에 남지 않습니다.
          </Bullet>
          <Bullet>
            <C>UNAUTHENTICATED</C> 는 종단(키를 고쳐야 함), <C>UNAVAILABLE</C> 은 재시도 대상(백오프)으로
            다루세요.
          </Bullet>
        </Bullets>
        <P>
          다음: 이 자격증명들이 열어 주는 엔드포인트를 보려면{" "}
          <DocsLink slug="api" locale={LOCALE}>
            REST API 레퍼런스
          </DocsLink>
          로.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}
