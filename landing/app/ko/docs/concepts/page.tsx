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
  CodeBlock,
  DocsLink,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "concepts";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 핵심 개념 (#143). 필드명·상태·`FailureType` 값·기본값 표의 키는 전부 영어로 남긴다 —
 * API 응답과 대시보드에 그 문자열이 그대로 나오므로, 번역하면 독자가 자기 화면에서 찾을 수 없다.
 * 도메인 타입(`ReputationCell`)도 영어 이름을 쓰고 뜻만 한국어로 설명한다.
 */
export default function DocsConceptsPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="resource" title="리소스 (Resource)">
        <P>
          리소스는 풀에서 서로 대체 가능한 구성원 하나이고, <C>kind</C> 와 <C>value</C> 로 식별됩니다.
        </P>
        <Bullets>
          <Bullet>
            <C>kind</C> — <C>PROXY</C>, <C>ACCOUNT</C>, <C>SESSION</C> 중 하나.
          </Bullet>
          <Bullet>
            <C>value</C> — 여러분이 정하고 여러분에게만 의미가 있는 불투명한 문자열. 프록시 엔드포인트, 계정
            id, 세션 핸들 같은 것. 풀은 이 값을 절대 파싱하지 않습니다.
          </Bullet>
        </Bullets>
        <P>
          이 한 쌍이 곧 신원입니다. <C>PROXY</C>/<C>proxy-1</C> 과 <C>ACCOUNT</C>/<C>proxy-1</C> 은 서로 다른
          리소스입니다. 등록은 멱등이므로 워커가 부팅할 때마다 <C>Register</C> 를 부르는 것이 정상적인
          패턴입니다.
        </P>
      </Section>

      <Section id="context" title="컨텍스트 (Context)">
        <P>
          컨텍스트는 <B>그 리소스를 무엇에 쓰는지</B> 이름 붙인 문자열입니다 — <C>checkout-us</C>,{" "}
          <C>search-eu</C>, <C>login-jp</C> 처럼. <C>Acquire</C> 와 <C>Report</C> 에 함께 넘기고, 모든 평판
          조회의 나머지 절반을 담당합니다.
        </P>
        <P>
          컨텍스트는 자유 형식이고 처음 쓰는 순간 생깁니다 — 등록 단계가 없습니다.{" "}
          <B>하나의 컨텍스트가, 리소스를 독립적으로 태울 수 있는 하나의 대상</B>이 되게 고르세요. 보통 목적지,
          여러분 쪽의 고객, 또는 워크로드 단위입니다. 너무 굵으면(모든 것에 <C>default</C>) 목적지 하나가
          나빠졌을 때 그 리소스가 전부에서 빠지고, 너무 잘게 쪼개면(요청마다 하나) 어떤 셀도 쓸 만한 이력을
          쌓지 못하는 데다 새 셀마다 풀의 셀 예산을 깎아먹습니다.
        </P>
      </Section>

      <Section id="cell" title="ReputationCell — (리소스 × 컨텍스트) 한 칸">
        <P>
          평판은 리소스별로 저장되지 않습니다. <B>리소스 × 컨텍스트</B> 조합별로 저장되고, 그 조합을 평판
          셀(<C>ReputationCell</C>)이라고 부릅니다. 리소스 하나는 그동안 쓰인 컨텍스트 수만큼의 셀을 갖고,
          각 셀이 자기 점수·자기 연속 기록·자기 쿨다운을 따로 가집니다.
        </P>
        <Table head={["필드", "의미"]}>
          <Row>
            <Cell>
              <C>score</C>
            </Cell>
            <Cell>
              <C>[-100, 100]</C> 범위의 연속적인 평판 점수. <C>0.0</C> 에서 시작하고, 보고된 결과마다 움직이며,
              선택 가중치가 됩니다.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>state</C>
            </Cell>
            <Cell>
              <C>HEALTHY</C> · <C>COOLING</C> · <C>RECOVERING</C> · <C>BLOCKLISTED</C> — 이 셀을 내줄 수 있는지
              결정하는 관문.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>consecutiveFailures</C>
            </Cell>
            <Cell>연속 실패 횟수. 쿨다운을 시작시키는 것은 이 값이 임계치에 닿는 순간입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>consecutiveSuccesses</C>
            </Cell>
            <Cell>연속 성공 횟수. 관찰 기간을 끝내는 것은 이 값이 복귀 임계치에 닿는 순간입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>windowSize</C>
            </Cell>
            <Cell>
              최근 결과를 몇 개 보관하는지(기본 10). 연속 카운터는 상한 없이 누적되는 값이고, 윈도는 크기가
              정해진 최근 이력입니다.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>cooldownUntil</C>
            </Cell>
            <Cell>
              현재 쿨다운이 끝나는 시각. 쿨다운 중이 아니면 <C>null</C>.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>updatedAt</C>
            </Cell>
            <Cell>이 셀에 마지막 결과가 반영된 시각.</Cell>
          </Row>
        </Table>
        <P>
          셀을 만드는 것은 <C>Report</C> 이고, <C>Acquire</C> 는 절대 만들지 않습니다. 그래서 방금 등록한
          리소스는 보고를 하기 전까지 대시보드에 <C>contexts: 0</C> 으로 보입니다. <C>Acquire</C> 는 후보를
          평가할 때 저장되지 않는 임시 신규 셀로 점수를 매기므로, 아무도 보고하지 않은 리소스는 중립이자{" "}
          <C>HEALTHY</C> 로 취급됩니다 — 새 리소스는 자격을 쌓을 필요 없이 곧바로 선택 대상이 됩니다.
        </P>

        <SubHeading>컨텍스트별로 나누는 것이 이 모델의 핵심입니다</SubHeading>
        <P>
          프록시 하나와 목적지 둘을 생각해 봅시다. 그 프록시가 결제 엔드포인트에서는 강하게 차단당했지만 검색
          쪽에서는 완벽하게 동작합니다. 평판을 리소스별로 저장하면 그 차단은 &quot;프록시에 대한 사실&quot;이
          되므로,
          검색에서 잘 되던 프록시를 잃든지 아니면 결제에 계속 타 버린 프록시를 밀어넣든지 둘 중 하나입니다.
          둘 다 틀렸고, 어느 쪽이 되는지는 여러분이 추측해서 정한 임계값에 달려 있습니다.
        </P>
        <CodeBlock language="text" title="one proxy, two independent cells">
          {`PROXY proxy-1.example.net:8080
├─ context "checkout-us"  score -34.0  state COOLING    cooldownUntil 10:41:02
└─ context "search-eu"    score  35.0  state HEALTHY    cooldownUntil null

Acquire("search-eu")   → may return proxy-1   (its search-eu cell is healthy)
Acquire("checkout-us") → will not return it   (its checkout-us cell is cooling)`}
        </CodeBlock>
        <P>
          셀이 있으면 그 차단은 <B>이 컨텍스트에서의 이 프록시</B>에 대한 사실이 됩니다. 프록시는 검색
          트래픽을 그대로 다 받고, 결제는 그 프록시를 우회하며, 결제 쪽 신뢰는 스스로 다시 벌어옵니다. 이걸
          여러분 코드에서 모델링할 필요가 없습니다 — 보고를 컨텍스트별로 하기만 하면 격리는 키에서 저절로
          따라옵니다.
        </P>
        <Callout title="예외 하나는 의도적입니다: 차단 목록">
          <P>
            쿨다운은 셀 단위이지만 <B>차단 목록은 리소스 단위</B>입니다. 운영자가 프록시를 차단 목록에 올리면
            모든 컨텍스트에서 한 번에 격리됩니다. &quot;이 리소스는 쓰지 말라&quot;는 것은 목적지 하나에 대한
            판단이 아니라 리소스에 대한 판단이기 때문입니다. 이 비대칭은 의도적입니다 — 아래{" "}
            <a href="#blocklist" className="font-medium text-accent hover:underline">
              차단 목록
            </a>{" "}
            을 보세요.
          </P>
        </Callout>
      </Section>

      <Section id="states" title="네 가지 상태">
        <Table head={["상태", "선택 대상인가?", "의미"]}>
          <Row>
            <Cell>
              <C>HEALTHY</C>
            </Cell>
            <Cell>예</Cell>
            <Cell>신뢰됨. 정상 상태입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>COOLING</C>
            </Cell>
            <Cell>아니오</Cell>
            <Cell>쿨다운이 끝날 때까지 빼 둔 상태.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>RECOVERING</C>
            </Cell>
            <Cell>예</Cell>
            <Cell>관찰 기간 — 다시 내주지만 아직 자기 증명 중입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>BLOCKLISTED</C>
            </Cell>
            <Cell>아니오</Cell>
            <Cell>명시적으로 풀어 줄 때까지 격리. 트래픽만으로는 절대 벗어나지 않습니다.</Cell>
          </Row>
        </Table>
        <CodeBlock language="text" title="the normal cycle">
          {`                 consecutiveFailures >= coolAfter (2)
   ┌───────────┐ ───────────────────────────────────▶ ┌───────────┐
   │  HEALTHY  │                                      │  COOLING  │
   └───────────┘ ◀─────────────────────┐              └───────────┘
        ▲                              │                    │
        │ consecutiveSuccesses         │                    │ cooldown expired,
        │ >= recoverAfter (2)          │                    │ then one success
        │                        ┌────────────┐ ◀───────────┘
        └──────────────────────  │ RECOVERING │
                                 └────────────┘

   BLOCKLISTED is reachable from any state via an operator block, and is left
   only by unblock or block expiry — never by reported outcomes.`}
        </CodeBlock>

        <SubHeading>쿨다운: 실패 하나가 실제로 하는 일</SubHeading>
        <P>
          보고된 실패는 모두 점수를 내리고 연속 실패 횟수를 하나 올립니다. 그 횟수가 쿨다운 임계치(기본{" "}
          <C>2</C>)에 닿을 때에만 셀이 <C>COOLING</C> 으로 넘어갑니다 — 한 번 튄 것으로 건강한 리소스를 빼지
          않습니다. 벌점과 쿨다운 길이는 둘 다 여러분이 보고한 실패 유형에 달려 있습니다.
        </P>
        <Table head={["FailureType", "점수 벌점", "기본 쿨다운", "이럴 때 쓰세요"]}>
          <Row>
            <Cell>
              <C>BLOCKED</C>
            </Cell>
            <Cell>30</Cell>
            <Cell>1 시간</Cell>
            <Cell>실제 차단 — 403, 캡차 벽, 밴 페이지.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>TLS_HANDSHAKE</C>
            </Cell>
            <Cell>15</Cell>
            <Cell>5 분</Cell>
            <Cell>TLS 협상 실패 — 중간 개입이거나 죽은 엔드포인트인 경우가 많습니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>CONNECTION_RESET</C>
            </Cell>
            <Cell>10</Cell>
            <Cell>2 분</Cell>
            <Cell>전송 중에 연결이 끊긴 경우.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>TIMEOUT</C>
            </Cell>
            <Cell>5</Cell>
            <Cell>1 분</Cell>
            <Cell>시간 안에 응답이 없는 경우.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>SLOW</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>30 초</Cell>
            <Cell>완료됐지만 쓸 만하다고 보기 어려울 만큼 느린 경우.</Cell>
          </Row>
        </Table>
        <P>
          쿨다운은 연속 실패마다 그 기본값을 두 배로 늘리고 64 배에서 멈춥니다 —{" "}
          <C>base(type) × 2^min(consecutiveFailures - 1, 6)</C>. 그래서 계속 차단당하는 프록시는 1 시간,
          2 시간, 4 시간… 으로 늘어나고, 영원히 한 시간마다 다시 시도되지 않습니다. 그저 느렸을 뿐인
          리소스는 30 초에서 시작합니다.
        </P>
        <Callout tone="warn" title="유형을 정직하게 보고하세요">
          <P>
            <C>BLOCKED</C> 는 <C>SLOW</C> 의 벌점 15 배, 쿨다운 120 배입니다. 그게 제일 눈에 익어서 모든 에러를{" "}
            <C>BLOCKED</C> 로 매핑하면 풀이 비고, 반대로 전부 <C>SLOW</C> 로 매핑하면 이미 타 버린 리소스를
            계속 내주게 됩니다. 실패 유형은 여러분이 실제로 통제할 수 있는 가장 중요한 튜닝 손잡이입니다.
          </P>
        </Callout>
        <P>
          쿨다운이 진행되는 동안 들어온 추가 실패는 점수는 계속 움직이지만 쿨다운을 다시 시작시키거나 cooling
          이벤트를 다시 내보내지는 <B>않습니다</B> — 늦게 도착한 결과는 이미 벌을 받고 있는 그 사고에 속하고
          새로운 사고가 아닙니다. 나쁜 1 분이 지수적으로 커지는 격리로 번지지 않게 막는 장치입니다.
        </P>

        <SubHeading>복귀: 셀이 신뢰를 다시 벌어오는 방법</SubHeading>
        <P>
          복귀는 시간만으로 되지 않고 성공이 있어야 합니다. 쿨다운이 끝나도 셀이 조용히 건강해지지는 않습니다 —
          그 뒤 처음 보고된 성공이 셀을 <C>RECOVERING</C> 으로 옮기고, 연속 성공 카운트는 그 순간부터 다시
          셉니다. 그래서 아직 쿨다운 중일 때 우연히 보고된 성공들로 관찰 기간을 건너뛸 수 없습니다.{" "}
          <C>recoverAfter</C> 만큼(기본 <C>2</C>) 연속 성공하면 <C>HEALTHY</C> 로 승격되고{" "}
          <C>ResourceRecovered</C> 이벤트가 나갑니다.
        </P>
        <P>
          <C>RECOVERING</C> 은 선택 대상입니다. 그게 핵심입니다 — 관찰 기간은 &quot;벤치에서 기다리는
          중&quot;이 아니라 &quot;로테이션에 돌아왔고 지켜보는 중&quot;이라는 뜻입니다. 관찰 기간에 실패가 한 번
          나오면 연속 성공이 초기화되고, 쿨다운 임계치에 닿으면 다시 빠집니다.
        </P>
      </Section>

      <Section id="score" title="점수와 선택 방식">
        <P>
          점수는 <C>[-100, 100]</C> 사이의 연속값이고 양끝에서 잘립니다. 성공은 <C>5</C> 를 더하고, 실패는 그
          유형의 벌점을 뺍니다. 상태와는 별개의 신호입니다 — 상태는 셀을 내줄 <B>수 있는지</B>를 정하고, 점수는
          내줄 수 있는 것들 중에서 <B>얼마나 자주</B> 뽑힐지를 정합니다.
        </P>
        <P>
          선택은 &quot;항상 가장 좋은 것&quot;이 아니라 점수 가중 무작위입니다. 자격 있는 후보 각각의 가중치는{" "}
          <C>(score − lowestScoreAmongCandidates) + 1.0</C> 이므로 점수가 높으면 더 자주 뽑히지만 자격 있는
          모든 후보가 0 이 아닌 확률을 유지합니다. 여기서 두 가지가 따라 나오고 둘 다 의도적입니다. 부하가
          가장 좋은 리소스 하나를 때리는 대신 건강한 풀 전체로 퍼지고, 가장 약한 자격 후보도 이따금 순서를
          받습니다 — 복귀 직전의 리소스가 영원히 굶지 않고 다시 시험받는 방식이 이것입니다.
        </P>
        <Callout title="가중치는 절대 눈금이 아니라 후보들 사이의 상대값입니다">
          <P>
            이미 자격을 갖춘 집합 안에서 중요한 것은 <B>지금</B> 누가 누구보다 나은지입니다. 전부 <C>-40</C>{" "}
            인 풀과 전부 <C>+40</C> 인 풀의 분배는 정확히 같습니다.
          </P>
        </Callout>
      </Section>

      <Section id="blocklist" title="차단 목록 (Blocklist)">
        <P>
          차단 목록은 운영자의 수동 개입이고, 위의 모든 것과 달리 <B>리소스</B> 단위입니다(셀 단위가 아닙니다).
          차단하면 모든 컨텍스트에서 한 번에 선택에서 격리되며, 엔진은 스스로 리소스를 이 집합에 넣거나
          빼지 않습니다.
        </P>
        <Bullets>
          <Bullet>
            <B>임시</B> — <C>POST …/block?seconds=3600</C>. 스스로 만료됩니다.
          </Bullet>
          <Bullet>
            <B>영구</B> — <C>POST …/block?permanent=true</C>. 명시적 해제로만 풀립니다.
          </Bullet>
          <Bullet>
            <B>해제</B> — <C>DELETE …/block</C>. <C>RESOURCE_UNBLOCKED</C> 이벤트를 내보냅니다.
          </Bullet>
        </Bullets>
        <P>
          차단은 진행 중인 획득도 이깁니다. 리소스가 선택된 뒤 리스가 확정되기 전에 차단되면, 그 확정은
          존중되지 않고 되돌려집니다 — 이미 응답이 돌아간 <C>block</C> 호출을 우회할 방법은 없습니다. 그리고{" "}
          <C>Renew</C> 는 차단 목록에 오른 리소스의 리스를 연장하지 않으므로, 이미 잡혀 있던 리스는 살아남지
          않고 TTL 에서 끝납니다.
        </P>
        <P>
          <C>BLOCKLISTED</C> 는 엔진에게 종단 상태이므로, 차단된 리소스에 대해 보고된 결과는 점수와 윈도는
          계속 움직이지만(나중에 해제를 판단할 근거가 됩니다) 상태를 바꾸지는 못합니다.
        </P>
      </Section>

      <Section id="leases" title="리스 (Lease)">
        <P>
          <C>Acquire</C> 는 리소스를 추천하는 데서 그치지 않고 <B>리스</B>합니다. 한 컨텍스트에 대한 배타적
          점유이고 기본 30 초 동안 유효합니다. 리스된 동안에는 다른 <C>Acquire</C> 가 그 리소스를 내주지
          않습니다 — 컨텍스트가 다르더라도 그렇습니다 — 그래서 두 워커가 실수로 한 프록시를 같이 쓰는 일이
          없습니다.
        </P>
        <Bullets>
          <Bullet>
            <C>Renew</C> 는 리스를 TTL 만큼 더 연장합니다. 작업이 창을 넘길 때 쓰세요.
          </Bullet>
          <Bullet>
            <C>Release</C> 는 리소스를 즉시 돌려줍니다. 정확성을 위해 필수는 아니지만(만료가 안전망입니다)
            제때 반납하는 것이 풀을 TTL 만료를 기다리는 상태가 아니라 일하는 상태로 유지합니다.
          </Bullet>
          <Bullet>
            리스는 단조 증가하는 <B>펜싱 토큰</B>을 함께 들고 있습니다. <C>Renew</C> 와 <C>Release</C> 는 현재
            보유자를 위해서만 동작하므로, 이미 리스가 만료돼 다른 워커가 다시 가져간 뒤에 늦게 도착한 호출이 새
            리스를 건드릴 수 없습니다.
          </Bullet>
        </Bullets>
        <P>
          리스는 런타임 조정 장치이고 영속 상태가 아닙니다. 풀 스냅샷에 포함되지 않으므로 재시작 직후에는
          아무것도 잡혀 있지 않습니다.
        </P>
      </Section>

      <Section id="events" title="이벤트">
        <P>
          위의 모든 판단은 이벤트로 나갑니다. 실시간 gRPC <C>SubscribeEvents</C> 스트림과{" "}
          <C>GET /api/events</C> 가 읽는 영구 감사 로그 양쪽으로 갑니다. 보게 될 이벤트 유형은{" "}
          <C>RESOURCE_LEASED</C>, <C>LEASE_RELEASED</C>, <C>RESOURCE_COOLED</C>(원인이 된 실패 유형과 쿨다운
          종료 시각 포함), <C>RESOURCE_RECOVERED</C>, <C>RESOURCE_BLOCKLISTED</C>, <C>RESOURCE_UNBLOCKED</C>{" "}
          입니다. 자격 있는 후보를 찾지 못한 획득은 실시간 스트림에서 <C>AcquisitionRejected</C> 로 보고됩니다.
        </P>
      </Section>

      <Section id="defaults" title="기본값 한눈에">
        <Table head={["손잡이", "기본값", "무엇을 정하는가"]}>
          <Row>
            <Cell>
              <C>windowSize</C>
            </Cell>
            <Cell>10</Cell>
            <Cell>셀마다 보관하는 최근 결과 수.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>coolAfter</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>쿨다운에 들어가기까지의 연속 실패 수.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>recoverAfter</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>관찰 기간을 벗어나기까지의 연속 성공 수.</Cell>
          </Row>
          <Row>
            <Cell>lease TTL</Cell>
            <Cell>30 초</Cell>
            <Cell>획득한 리스가 유효한 시간.</Cell>
          </Row>
          <Row>
            <Cell>쿨다운 백오프 상한</Cell>
            <Cell>기본값의 64 배</Cell>
            <Cell>지수적으로 늘어나는 쿨다운의 천장.</Cell>
          </Row>
          <Row>
            <Cell>점수 범위</Cell>
            <Cell>−100 … 100</Cell>
            <Cell>연속적인 평판 값을 자르는 범위.</Cell>
          </Row>
        </Table>
        <P>
          이 값들은 호스티드 배포의 설정이고, 엔진의 레퍼런스 기본값과 같습니다. 이 페이지의 모든 규칙 —
          벌점, 백오프 곡선, 전이 조건, 선택 가중치 — 은 오픈소스 엔진{" "}
          <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A> 에 구현돼 있으므로, 이 페이지의 말을 믿는
          대신 소스를 읽을 수 있습니다. 다음:{" "}
          <DocsLink slug="authentication" locale={LOCALE}>
            인증
          </DocsLink>
          .
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}
