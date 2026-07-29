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
  Endpoint,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "api";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 REST API 레퍼런스 (#143). 메서드·경로·쿼리 파라미터 이름·JSON 키와 값·HTTP 상태·gRPC 상태·
 * 에러 `detail` 문구는 전부 영어로 남긴다 — 응답에 그대로 나오는 문자열을 번역하면 레퍼런스가 아니라
 * 오해의 원인이 된다. 설명 산문만 한국어다.
 */
export default function DocsApiPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="conventions" title="공통 규칙">
        <Bullets>
          <Bullet>
            <B>기준 주소</B> — <C>https://&lt;your-console-host&gt;/api</C>, 직접 띄운 스택이라면{" "}
            <C>http://localhost:8080/api</C>. 컨트롤플레인은 대시보드와 같은 오리진에서 서빙되므로 브라우저
            도구에 CORS 설정이 필요하지 않습니다.
          </Bullet>
          <Bullet>
            <B>인증</B> — <C>POST /api/auth/login</C> 을 제외한 모든 엔드포인트가{" "}
            <C>Authorization: Bearer &lt;jwt&gt;</C> 를 요구합니다. 여기서는 API 키가 통하지 않습니다.{" "}
            <DocsLink slug="authentication" locale={LOCALE}>
              인증
            </DocsLink>
            을 보세요.
          </Bullet>
          <Bullet>
            <B>테넌트</B> — 범위가 있는 조회는 파라미터가 아니라 토큰의 테넌트를 씁니다. 다른 테넌트의 데이터를
            요청할 방법이 없습니다.
          </Bullet>
          <Bullet>
            <B>시각</B> — UTC 기준 ISO-8601 순간값. <C>null</C> 은 &quot;설정되지 않음&quot;을 뜻합니다(쿨다운
            없음, 만료 없음, 폐기되지 않음).
          </Bullet>
          <Bullet>
            <B>에러</B> — RFC 7807 <C>application/problem+json</C>. 정리된 사유는 <C>detail</C> 에 들어갑니다.
          </Bullet>
        </Bullets>
        <CodeBlock language="json" title="error shape">
          {`{"type":"about:blank","title":"Not Found","status":404,"detail":"resource not found"}`}
        </CodeBlock>
        <Table head={["상태", "이럴 때"]}>
          <Row>
            <Cell>
              <C>400</C>
            </Cell>
            <Cell>엔드포인트가 직접 검증하는 잘못된 입력 — 모르는 리소스 kind, 손상된 cursor.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>401</C>
            </Cell>
            <Cell>토큰이 없거나 형식이 잘못됐거나 만료됨, 또는 로그인 자격증명이 틀림. 다시 로그인하세요.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>403</C>
            </Cell>
            <Cell>토큰이 테넌트에 묶여 있지 않거나, 다른 테넌트를 향하거나, 그 테넌트가 정지·삭제됨.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>404</C>
            </Cell>
            <Cell>지정한 대상이 이 테넌트에는 존재하지 않음.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>409</C>
            </Cell>
            <Cell>쓰기가 기존 상태와 충돌함.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>429</C>
            </Cell>
            <Cell>
              로그인 제한에 걸림. <C>Retry-After</C> 를 지키세요.
            </Cell>
          </Row>
        </Table>
        <Callout title="이 문서는 컨트롤플레인만 다룹니다">
          <P>
            <C>Acquire</C>, <C>Report</C>, <C>Register</C>, <C>Renew</C>, <C>Release</C>, 그리고 실시간 이벤트
            스트림은 REST 엔드포인트가 아니라 데이터플레인의 gRPC RPC 입니다 — 앞에 HTTP 게이트웨이가 없습니다.
            그쪽은{" "}
            <DocsLink slug="quickstart" locale={LOCALE}>
              퀵스타트
            </DocsLink>
            와 이 페이지 맨 아래{" "}
            <a href="#grpc" className="font-medium text-accent hover:underline">
              gRPC 요약
            </a>
            을 보세요.
          </P>
          <P>
            반대 방향의 구분도 중요합니다. 인터넷에 공개된 평면은 이 REST 표면이 <B>유일</B>합니다. gRPC 포트는
            모든 배포에서 loopback 에 바인딩돼 있으므로, 아래 RPC 들은 직접 띄운 스택에서만 닿고 호스티드
            주소로는 닿지 않습니다.
          </P>
        </Callout>
      </Section>

      <Section id="auth" title="인증">
        <Endpoint id="post-login" method="POST" path="/api/auth/login">
          <P>관리자 자격증명을 컨트롤플레인 JWT 로 교환합니다. /api 아래의 유일한 공개 엔드포인트입니다.</P>
          <CodeBlock language="json" title="request">
            {`{"username":"admin","password":"…"}`}
          </CodeBlock>
          <CodeBlock language="json" title="200 OK">
            {`{"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}`}
          </CodeBlock>
          <P>
            <B>에러.</B> 잘못된 사용자명, 잘못된 비밀번호, <B>그리고</B> 설정되지 않은 콘솔이 모두{" "}
            <C>401 invalid credentials</C> 입니다 — 세 경우를 구분할 수 없게 한 것이 의도입니다. 이 출처 IP 가
            제한에 걸린 뒤에는 <C>429</C> 입니다.
          </P>
        </Endpoint>
      </Section>

      <Section id="pools" title="풀 상태">
        <Endpoint id="get-resources" method="GET" path="/api/pools/resources">
          <P>
            KPI 요약과, 테넌트의 풀이 알고 있는 리소스마다 한 행 — 등록된 것, 차단 목록에 오른 것, 셀에서만
            보인 것 모두 포함합니다. 행은 <C>kind</C> 다음 <C>value</C> 순으로 정렬됩니다.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`{
  "summary": {
    "registered": 42,
    "blocklisted": 1,
    "totalCells": 96,
    "cellsByState": {"HEALTHY": 81, "COOLING": 12, "RECOVERING": 3, "BLOCKLISTED": 0}
  },
  "resources": [
    {
      "kind": "PROXY",
      "value": "proxy-1.example.net:8080",
      "registered": true,
      "blocked": false,
      "blockedUntil": null,
      "blockPermanent": false,
      "contexts": 2,
      "state": "COOLING",
      "score": -34.0,
      "recentWindow": [true, true, false, false]
    }
  ]
}`}
          </CodeBlock>
          <P>
            한 행은 그 리소스의 셀들을 대표값으로 집계한 것이고, 규칙은 &quot;가장 나쁜 컨텍스트를
            드러낸다&quot; 입니다 — 운영자가 먼저 봐야 하는 것이 그것이기 때문입니다.
          </P>
          <Bullets>
            <Bullet>
              <C>state</C> — 셀 상태 중 심각도가 가장 높은 것(<C>BLOCKLISTED</C> &gt; <C>COOLING</C> &gt;{" "}
              <C>RECOVERING</C> &gt; <C>HEALTHY</C>). 리소스 자체가 차단됐으면 곧바로 <C>BLOCKLISTED</C>,
              셀이 아직 없으면 <C>HEALTHY</C>.
            </Bullet>
            <Bullet>
              <C>score</C> — 셀들 중 가장 낮은 점수. 셀이 없으면 <C>null</C>.
            </Bullet>
            <Bullet>
              <C>recentWindow</C> — <B>점수가 가장 낮은</B> 셀의 윈도를 성공 플래그로(오래된 것 → 최신 순)
              보여 줍니다. 셀이 없으면 빈 배열입니다. 심각도와 최저 점수는 따로 계산되므로, 한 행이{" "}
              <C>COOLING</C> 이라고 표시하면서 점수를 끌어내리고 있는 다른 컨텍스트의 윈도를 보여 줄 수 있습니다.
            </Bullet>
            <Bullet>
              <C>contexts</C> — 리소스가 가진 셀 수. <C>0</C> 은 등록됐지만 보고된 적이 없다는 뜻입니다.
            </Bullet>
            <Bullet>
              <C>blockedUntil</C> — 임시 차단의 만료 시각. 차단이 풀렸거나 <B>영구</B> 차단이면 <C>null</C>{" "}
              이므로 <C>blockPermanent</C> 와 함께 읽어야 합니다.
            </Bullet>
          </Bullets>
        </Endpoint>

        <Endpoint id="get-resource" method="GET" path="/api/pools/resources/{kind}/{value}">
          <P>리소스 하나를 컨텍스트별 셀로 펼쳐서, 컨텍스트 순으로 정렬해 돌려줍니다.</P>
          <Table head={["경로 파라미터", "값"]}>
            <Row>
              <Cell>
                <C>kind</C>
              </Cell>
              <Cell>
                <C>PROXY</C> · <C>ACCOUNT</C> · <C>SESSION</C> (대소문자 구분 없음)
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>value</C>
              </Cell>
              <Cell>리소스 값, URL 인코딩해서 넣습니다.</Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "kind": "PROXY",
  "value": "proxy-1.example.net:8080",
  "registered": true,
  "blocked": false,
  "blockedUntil": null,
  "blockPermanent": false,
  "cells": [
    {
      "context": "checkout-us",
      "score": -34.0,
      "consecutiveFailures": 2,
      "consecutiveSuccesses": 0,
      "windowSize": 10,
      "state": "COOLING",
      "cooldownUntil": "2026-07-29T10:41:02Z",
      "updatedAt": "2026-07-29T09:41:02Z"
    },
    {
      "context": "search-eu",
      "score": 35.0,
      "consecutiveFailures": 0,
      "consecutiveSuccesses": 7,
      "windowSize": 10,
      "state": "HEALTHY",
      "cooldownUntil": null,
      "updatedAt": "2026-07-29T09:44:18Z"
    }
  ]
}`}
          </CodeBlock>
          <P>
            <B>에러.</B> 모르는 kind 이거나 값이 비었으면 <C>400 invalid resource kind or value</C>. 풀이 이
            리소스를 한 번도 본 적이 없으면 — 즉 셀이 없고, 등록되지 않았고, 차단되지도 않았으면 —{" "}
            <C>404 resource not found</C>.
          </P>
        </Endpoint>

        <Endpoint id="get-score-history" method="GET" path="/api/pools/resources/{kind}/{value}/score-history">
          <P>
            리소스의 점수 곡선을 샘플링한 값이고, 컨텍스트마다 시간 오름차순 시리즈 하나입니다. 대시보드의
            24 시간 차트가 그리는 데이터입니다.
          </P>
          <Table head={["쿼리 파라미터", "기본값", "설명"]}>
            <Row>
              <Cell>
                <C>hours</C>
              </Cell>
              <Cell>
                <C>24</C>
              </Cell>
              <Cell>
                얼마나 과거까지 읽을지. <C>[1, 720]</C>(30 일) 범위로 잘리므로 범위를 벗어난 값은 거절되는 대신
                조용히 보정됩니다 — 그리고 어떤 호출자도 무한 스캔을 유발할 수 없습니다.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "contexts": [
    {"context": "checkout-us",
     "points": [{"at":"2026-07-29T08:00:00Z","score":15.0},
                {"at":"2026-07-29T08:01:00Z","score":-15.0}]},
    {"context": "search-eu",
     "points": [{"at":"2026-07-29T08:00:00Z","score":30.0}]}
  ]
}`}
          </CodeBlock>
          <P>
            점수는 보고마다 기록되는 것이 아니라 타이머로(1 분에 한 번) 샘플링되므로, 이 곡선은 결과 전체의
            이력이 아니라 표본입니다. 모르는 리소스는 <C>200</C> 과 빈 <C>contexts</C> 배열로 답합니다 —
            시리즈가 없는 것일 뿐입니다. 표본은 7 일간 보존됩니다.{" "}
            <DocsLink slug="faq" locale={LOCALE}>
              자주 묻는 질문
            </DocsLink>
            을 보세요.
          </P>
        </Endpoint>

        <Endpoint id="post-block" method="POST" path="/api/pools/resources/{kind}/{value}/block">
          <P>
            리소스를 차단 목록에 올립니다 — <B>모든</B> 컨텍스트에서 한 번에 선택에서 격리하는 운영자 개입입니다.{" "}
            <C>204 No Content</C> 를 돌려줍니다.
          </P>
          <Table head={["쿼리 파라미터", "기본값", "설명"]}>
            <Row>
              <Cell>
                <C>permanent</C>
              </Cell>
              <Cell>
                <C>false</C>
              </Cell>
              <Cell>
                <C>true</C> 면 만료 없이 차단하고, 명시적 해제로만 풀립니다.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>seconds</C>
              </Cell>
              <Cell>
                <C>3600</C>
              </Cell>
              <Cell>
                임시 차단의 TTL. <C>permanent=true</C> 일 때는 무시되고, 0 이하 값은 기본값으로 대체됩니다.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="bash" title="temporary and permanent">
            {`curl -sS -X POST "https://$RP_HOST/api/pools/resources/proxy/proxy-1/block?seconds=7200" \\
  -H "Authorization: Bearer $RP_JWT"

curl -sS -X POST "https://$RP_HOST/api/pools/resources/proxy/proxy-1/block?permanent=true" \\
  -H "Authorization: Bearer $RP_JWT"`}
          </CodeBlock>
          <P>
            차단은 <C>RESOURCE_BLOCKLISTED</C> 를 내보내므로 나머지 타임라인과 함께 감사 로그와 실시간
            스트림에 남습니다. 이미 차단된 리소스를 다시 차단하면 기존 항목을 덮어씁니다. kind 나 값이 잘못되면{" "}
            <C>400</C> 입니다.
          </P>
        </Endpoint>

        <Endpoint id="delete-block" method="DELETE" path="/api/pools/resources/{kind}/{value}/block">
          <P>
            리소스를 차단 목록에서 풀어 줍니다. <C>204 No Content</C> 를 돌려주고, 실제로 차단돼 있었을 때만{" "}
            <C>RESOURCE_UNBLOCKED</C> 를 내보냅니다 — 차단되지 않은 것을 해제하는 것은 유령 감사 기록을 남기는
            대신 아무 일도 하지 않습니다. kind 나 값이 잘못되면 <C>400</C> 입니다.
          </P>
          <P>
            해제는 평판을 초기화하지 않습니다. 리소스는 셀 상태를 그대로 들고 선택 대상으로 돌아오므로, 아직
            쿨다운 중인 셀은 자기 컨텍스트에서 쿨다운이 끝날 때까지 계속 빠져 있습니다.
          </P>
        </Endpoint>
      </Section>

      <Section id="events" title="감사 이벤트">
        <Endpoint id="get-events" method="GET" path="/api/events">
          <P>
            테넌트의 감사 로그 한 페이지를 최신순으로, keyset(cursor) 페이지네이션으로 돌려줍니다 — 얼마나 과거로
            내려갔든 한 페이지의 비용이 일정합니다.
          </P>
          <Table head={["쿼리 파라미터", "기본값", "설명"]}>
            <Row>
              <Cell>
                <C>cursor</C>
              </Cell>
              <Cell>—</Cell>
              <Cell>
                불투명하고 URL 에 안전한 값. 없으면 &quot;최신부터&quot;, 있으면 그 커서 바로 이전(더 오래된)
                페이지를 뜻합니다.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>limit</C>
              </Cell>
              <Cell>
                <C>50</C>
              </Cell>
              <Cell>
                페이지 크기. <C>[1, 500]</C> 로 잘립니다.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "events": [
    {"seq": 918, "eventType": "RESOURCE_COOLED", "resourceKind": "PROXY",
     "resourceValue": "proxy-1.example.net:8080", "context": "checkout-us",
     "occurredAt": "2026-07-29T09:41:02Z", "until": "2026-07-29T10:41:02Z", "cause": "BLOCKED"},
    {"seq": 917, "eventType": "RESOURCE_LEASED", "resourceKind": "PROXY",
     "resourceValue": "proxy-1.example.net:8080", "context": "checkout-us",
     "occurredAt": "2026-07-29T09:40:58Z", "until": "2026-07-29T09:41:28Z", "cause": null}
  ],
  "nextCursor": "OTE3"
}`}
          </CodeBlock>
          <Table head={["필드", "의미"]}>
            <Row>
              <Cell>
                <C>seq</C>
              </Cell>
              <Cell>원장의 전체 순서. 페이지 안에서도, 페이지를 넘어서도 엄격히 감소합니다.</Cell>
            </Row>
            <Row>
              <Cell>
                <C>eventType</C>
              </Cell>
              <Cell>
                <C>RESOURCE_LEASED</C> · <C>LEASE_RELEASED</C> · <C>RESOURCE_COOLED</C> · <C>RESOURCE_RECOVERED</C> ·{" "}
                <C>RESOURCE_BLOCKLISTED</C> · <C>RESOURCE_UNBLOCKED</C>
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>context</C>
              </Cell>
              <Cell>
                셀의 컨텍스트. 차단 목록 변경처럼 리소스 단위 이벤트에서는 <C>null</C> 입니다.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>until</C>
              </Cell>
              <Cell>
                유형에 따라 쿨다운 종료·리스 만료·차단 만료 시각. 유형에 기한이 없거나 차단이 영구이면{" "}
                <C>null</C> 입니다.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>cause</C>
              </Cell>
              <Cell>
                <C>RESOURCE_COOLED</C> 를 일으킨 <C>FailureType</C>. 그 밖에는 <C>null</C>.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>nextCursor</C>
              </Cell>
              <Cell>
                다음(더 오래된) 페이지를 위해 <C>cursor</C> 로 되돌려주는 값. <C>null</C> 이면 마지막 페이지였다는
                뜻입니다.
              </Cell>
            </Row>
          </Table>
          <P>
            <B>에러.</B> 이 엔드포인트에서 받은 것이 아닌 커서를 주면 <C>400 invalid cursor</C> 입니다. 커서를
            직접 만들지 마세요 — 인코딩은 계약의 일부가 아닙니다.
          </P>
          <CodeBlock language="bash" title="walking the whole trail">
            {`cursor=""
while :; do
  page=$(curl -sS "https://$RP_HOST/api/events?limit=500&cursor=$cursor" \\
           -H "Authorization: Bearer $RP_JWT")
  echo "$page" | jq -c '.events[]'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done`}
          </CodeBlock>
        </Endpoint>
      </Section>

      <Section id="usage" title="사용량">
        <Endpoint id="get-usage" method="GET" path="/api/usage">
          <P>
            테넌트의 측정된 사용량 — 최근 30 일간 리스 발급 수, 이번 달(달력 기준) 합계, 그리고 가장 최근에
            샘플링한 풀 크기입니다. 날짜는 UTC 기준입니다.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`{
  "monthLeaseTotal": 128400,
  "poolSize": 42,
  "dailyLeases": [
    {"date": "2026-07-28", "count": 5120},
    {"date": "2026-07-29", "count": 3980}
  ]
}`}
          </CodeBlock>
          <P>
            리스는 <B>발급된</B> 시점에 집계되므로 <C>granted: false</C> 로 끝난 <C>Acquire</C> 는 세지 않습니다.
            카운트는 메모리에 모아 타이머로(1 분에 한 번) 내려쓰므로, 오늘 숫자는 실시간 트래픽보다 조금 뒤처집니다.
            활동이 없는 날은 0 으로 들어가는 대신 배열에서 아예 빠집니다.
          </P>
        </Endpoint>
      </Section>

      <Section id="api-keys" title="API 키">
        <P>
          세 엔드포인트 모두 <C>tenantId</C> 경로 파라미터를 받고, 그것은 토큰이 묶인 테넌트여야 합니다 —
          아니면 <C>403 forbidden</C> 이고, 이 검사는 존재 확인보다 먼저 돌아서 응답이 다른 테넌트의 존재를
          드러낼 수 없습니다. 존재하지 않는 <C>tenantId</C> 는 <C>404 tenant not found</C> 로 답합니다. 저장·
          교체·폐기의 의미는{" "}
          <DocsLink slug="authentication" locale={LOCALE}>
            인증
          </DocsLink>
          에 있습니다.
        </P>

        <Endpoint id="post-api-key" method="POST" path="/api/tenants/{tenantId}/api-keys">
          <P>
            데이터플레인 API 키를 발급합니다. <C>201 Created</C> 를 돌려줍니다. 본문은 선택 사항이며, 생략하면
            레이블 없는 키가 됩니다.
          </P>
          <CodeBlock language="json" title="request (optional)">
            {`{"label":"worker-01"}`}
          </CodeBlock>
          <CodeBlock language="json" title="201 Created">
            {`{
  "id": "5f1c2b40-…",
  "rawToken": "rp_9Q3xK7bT…",
  "label": "worker-01",
  "prefix": "rp_9Q3xK7bT",
  "createdAt": "2026-07-29T09:12:44Z"
}`}
          </CodeBlock>
          <Callout tone="warn" title="rawToken 은 여기에만 나오고 다른 어디에도 나오지 않습니다">
            <P>
              SHA-256 해시만 저장되므로 이 값을 다시 돌려줄 수 있는 엔드포인트가 없습니다. 이 응답에서 챙기거나,
              새 키를 발급하세요.
            </P>
          </Callout>
        </Endpoint>

        <Endpoint id="get-api-keys" method="GET" path="/api/tenants/{tenantId}/api-keys">
          <P>
            테넌트의 모든 키를 오래된 순으로 — 키 원문은 절대 없고, 비밀이 아닌 표시용 접두사만 들어 있습니다.{" "}
            <C>revokedAt</C> 이 null 이 아니면 그 키로는 더 이상 인증되지 않습니다.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`[
  {"id":"5f1c2b40-…","label":"worker-01","prefix":"rp_9Q3xK7bT",
   "createdAt":"2026-07-29T09:12:44Z","revokedAt":null}
]`}
          </CodeBlock>
        </Endpoint>

        <Endpoint id="delete-api-key" method="DELETE" path="/api/tenants/{tenantId}/api-keys/{keyId}">
          <P>
            활성 키를 <C>id</C> 로 폐기합니다. <C>204 No Content</C> 를 돌려줍니다. 즉시 적용되므로 그 키로
            보내는 다음 gRPC 호출부터 실패합니다.
          </P>
          <P>
            <B>에러.</B> <C>404 api key not found</C> 가 &quot;모르는 id&quot;, &quot;이미 폐기됨&quot;,
            &quot;다른 테넌트의 키&quot; 세 경우를 모두 덮으며, 구분하지 않습니다.
          </P>
        </Endpoint>
      </Section>

      <Section id="grpc" title="gRPC 데이터플레인 — 참고용">
        <P>
          REST 는 아니지만 표면 전체를 한 곳에서 보기 위해 함께 적습니다. 서비스는{" "}
          <C>io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor</C> 이고, <C>x-api-key</C> 메타데이터로
          인증하며, 앱 컨테이너의 <C>9093</C> 포트에서 서빙됩니다 — <C>127.0.0.1</C> 에만 공개되므로 호스티드
          호스트명이 아니라 직접 띄운 스택에서 닿습니다. 메시지 모양과 실행 가능한 호출 예제는{" "}
          <DocsLink slug="quickstart" locale={LOCALE}>
            퀵스타트
          </DocsLink>
          에 있습니다.
        </P>
        <Table head={["RPC", "요청 → 응답", "설명"]}>
          <Row>
            <Cell>
              <C>Register</C>
            </Cell>
            <Cell>
              <C>ResourceId</C> → 빈 응답
            </Cell>
            <Cell>멱등. 리소스를 선택 대상으로 만듭니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Acquire</C>
            </Cell>
            <Cell>
              <C>Context</C> → <C>granted</C>, <C>lease</C>
            </Cell>
            <Cell>
              리스 없는 <C>granted: false</C> 는 에러가 아니라 정상적인 답입니다.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>Report</C>
            </Cell>
            <Cell>
              <C>ResourceId</C>, <C>Context</C>, <C>Outcome</C> → 빈 응답
            </Cell>
            <Cell>평판을 움직이는 유일한 호출이고, 셀을 만드는 유일한 호출입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Renew</C>
            </Cell>
            <Cell>
              <C>LeaseHandle</C> → <C>renewed</C>, <C>lease</C>
            </Cell>
            <Cell>차단 목록에 오른 리소스는 거절합니다 — 그 리스는 TTL 에서 끝납니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Release</C>
            </Cell>
            <Cell>
              <C>LeaseHandle</C> → <C>released</C>
            </Cell>
            <Cell>현재 보유자의 펜싱 토큰만 반납할 수 있습니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>SubscribeEvents</C>
            </Cell>
            <Cell>
              빈 요청 → <C>stream PoolEvent</C>
            </Cell>
            <Cell>
              실시간이고 테넌트 범위입니다. 영구 저장 쪽 대응물은 <C>GET /api/events</C> 입니다.
            </Cell>
          </Row>
        </Table>
        <SubHeading>gRPC 상태 코드</SubHeading>
        <Table head={["상태", "이럴 때"]}>
          <Row>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>키가 없거나 모르는 키이거나 폐기된 키, 또는 그 키의 테넌트가 활성이 아님.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>UNAVAILABLE</C>
            </Cell>
            <Cell>자격증명을 확인할 수 없었음(저장소에 닿지 않음). 재시도 대상입니다.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>INVALID_ARGUMENT</C>
            </Cell>
            <Cell>
              잘못된 요청 — <C>kind</C> 가 비어 있거나, 리소스 값이 공백이거나, 컨텍스트가 없는 경우.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>RESOURCE_EXHAUSTED</C>
            </Cell>
            <Cell>
              호출이 서비스 전체 예산을 넘겨 새 풀 상태를 만들려는 경우(<C>Register</C> 의 새 리소스,{" "}
              <C>Report</C> 의 새 셀). 기존 상태만 건드리는 호출은 영향을 받지 않습니다 —{" "}
              <DocsLink slug="faq" locale={LOCALE}>
                자주 묻는 질문
              </DocsLink>
              을 보세요.
            </Cell>
          </Row>
        </Table>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}
