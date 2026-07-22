import type { Dict } from "./dictionary";

/** 인라인 코드 강조(악센트) — body ReactNode 안에서 재사용. */
const C = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[0.92em] text-accent">{children}</code>
);

/** 한국어 사전(`/ko`). 코드 토큰·제품명은 원문 유지, 산문만 번역한다. */
export const ko: Dict = {
  meta: {
    title: "reputation·pool — 프록시·계정 풀을 위한 평판 API",
    description:
      "쿨다운, 차단 목록, 리스 로직을 직접 짤 필요 없습니다. 가장 상태 좋은 리소스를 받아 쓰고 결과만 알려주면 — 검증된 오픈소스 엔진이 풀을 알아서 관리하고 되살립니다.",
  },

  a11y: { enlarge: "스크린샷 확대", closeDialog: "닫기" },

  nav: {
    links: { features: "기능", how: "동작 방식", docs: "문서" },
    getStarted: "시작하기",
    github: "GitHub",
    openSource: "오픈소스",
    home: "reputation·pool 홈",
    menuOpen: "메뉴 열기",
    menuClose: "메뉴 닫기",
    language: "언어",
  },

  hero: {
    badge: "리소스 풀을 위한 평판 관리 인프라",
    title: "프록시·계정 풀을 위한 평판 API.",
    bodyLead: "쿨다운, 차단 목록, 리스 로직을 직접 짜지 마세요.",
    bodyBold: "가장 상태 좋은 리소스를 받아 쓰고, 결과만 알려주세요",
    bodyTail: "— 검증된 오픈소스 엔진이 풀을 알아서 되살립니다.",
    ctaPrimary: "시작하기",
    ctaSecondary: "문서 보기",
    footnote: "정형 검증을 거친 완전 오픈소스 엔진 기반",
  },

  trust: {
    heading: "신뢰는 로고가 아니라 엔진에서 나옵니다",
    items: [
      { title: "오픈소스", sub: "엔진 전체를 GitHub 에 공개" },
      { title: "Lincheck", sub: "동시성 정확성(선형화) 증명" },
      { title: "뮤테이션 테스트", sub: "진짜 버그를 잡아내는 테스트" },
      { title: "감사 로그", sub: "모든 판단을 빠짐없이 기록" },
    ],
  },

  features: {
    label: "팀들이 갈아타는 이유",
    heading: "나쁜 리소스는 잠시 빼두고, 좋은 것만 골라 씁니다.",
    items: [
      {
        kicker: "자동 쿨다운·복귀",
        title: "실패한 리소스는 잠시 물러났다가, 스스로 제자리로 돌아옵니다.",
        body: "결과만 보고하면, 엔진이 실패가 반복되는 리소스를 잠시 쉬게 하고(쿨다운) 풀에서 따로 빼둡니다. 그리고 시간이 지나면 조금씩 다시 투입해 상태를 살피죠 — 불량 프록시가 작업을 망치는 대신, 스스로 컨디션을 회복합니다.",
        alt: "reputation-pool 대시보드 — 풀 오버뷰: 리소스별 상태·점수·최근 판정",
      },
      {
        kicker: "컨텍스트별 분리",
        title: "한 곳에서 생긴 문제가 다른 곳까지 번지지 않습니다.",
        body: (
          <>
            평판은 <C>resource × context</C> 단위(셀)로 따로 매깁니다. 같은 프록시라도 <C>checkout-us</C> 에서 문제가
            생겼다고 <C>search-eu</C> 까지 나빠지지 않죠 — 컨텍스트마다 상태와 쿨다운을 따로 관리하니까요.
          </>
        ),
        alt: "reputation-pool 대시보드 — 리소스 상세: 컨텍스트별 평판 곡선",
      },
      {
        kicker: "실시간 대시보드",
        title: "리소스 확보·쿨다운·복귀를 실시간으로 지켜봅니다.",
        body: (
          <>
            풀 현황, 평판 곡선, 실시간 이벤트까지 한눈에 — 쿼리를 짜거나 어림짐작할 필요가 없습니다. 지표는{" "}
            <C>/actuator/prometheus</C> 로 나가 여러분의 Grafana 에 바로 연결됩니다.
          </>
        ),
        alt: "reputation-pool 대시보드 — 확보·쿨다운·복귀 실시간 이벤트 스트림",
      },
    ],
  },

  caps: {
    label: "모두 기본 포함",
    heading: "실제 자동화 인프라를 위해 만들어졌습니다.",
    intro:
      "따로 사야 하는 추가 기능도, 기본 기능을 열려고 올려야 하는 요금제도 없습니다 — 제대로 된 워크로드에 필요한 인터페이스와 신호가 처음부터 다 들어 있습니다.",
    items: [
      {
        title: "gRPC & REST",
        body: "엔진 하나에 두 개의 창구 — 빠른 처리에는 gRPC 데이터 플레인, 도구 연동에는 REST 컨트롤 플레인.",
      },
      {
        title: "실시간 이벤트 스트림",
        body: "리소스 확보·쿨다운·차단·복귀가 일어나는 순간 그대로 구독하세요.",
      },
      {
        title: "Prometheus 메트릭",
        body: (
          <>
            <C>/actuator/prometheus</C> 를 여러분의 Grafana 에서 바로 수집하세요.
          </>
        ),
      },
      {
        title: "감사 로그",
        body: "모든 쿨다운·차단·확보 판단을 오래 남고 조회 가능한 로그로 기록합니다.",
      },
      {
        title: "컨텍스트별 평판",
        body: (
          <>
            상태를 <C>resource × context</C> 단위로 추적합니다 — 한 컨텍스트의 실패가 다른 컨텍스트로 번지지 않습니다.
          </>
        ),
      },
      {
        title: "오픈소스 엔진",
        body: "코어 엔진은 GitHub 에 Apache-2.0 으로 공개돼 있습니다. 직접 셀프호스팅해도 되고, 호스팅형 API 로 맡기셔도 됩니다.",
      },
    ],
  },

  steps: {
    label: "동작 방식",
    heading: "세 번의 호출. 나머지는 엔진이 합니다.",
    intro:
      "gRPC 든 REST 든 상관없습니다 — 리소스를 한 번 등록해 두고, 컨텍스트별로 확보해서 결과만 보고하세요. 쿨다운·격리·복귀는 여러분이 짤 코드가 아닙니다.",
    items: [
      { title: "키 발급", body: "대시보드에서 API 키를 발급하고, 클라이언트를 gRPC 또는 REST 엔드포인트로 연결하세요." },
      { title: "등록 & 확보", body: "리소스를 한 번 등록해 두고, 컨텍스트별로 가장 상태 좋은 것을 요청하세요." },
      { title: "결과 보고", body: "무슨 일이 있었는지 풀에 알려주기만 하세요. 쿨다운·격리·복귀는 알아서 처리됩니다." },
    ],
  },

  docs: {
    label: "문서",
    heading: "5분 만에 시작합니다.",
    intro:
      "키를 발급하고 리소스를 등록한 다음, 확보하고 보고까지 — 퀵스타트가 전체 흐름을 여러분이 쓰는 언어로 안내합니다.",
    items: [
      { tag: "5분", title: "퀵스타트", body: "키 → 등록 → 확보 → 보고, 처음부터 끝까지 복붙 가능.", go: "바로 시작하기 →" },
      { tag: "레퍼런스", title: "API 레퍼런스", body: "6개 gRPC RPC 와 REST 컨트롤 플레인, 모든 필드 문서화.", go: "API 살펴보기 →" },
      { tag: "가이드", title: "핵심 개념", body: "평판, 쿨다운, 컨텍스트, 확보 — 엔진이 실제로 판단하는 방식.", go: "모델 이해하기 →" },
    ],
  },

  contact: {
    label: "이용 신청",
    heading: "지금은 팀별로 하나씩 직접 안내해 드리고 있습니다.",
    body: "아직 온라인 자동 가입은 열어 두지 않았습니다 — 팀마다 저희가 직접 초기 세팅을 도와, 풀이 처음부터 안정적으로 돌아가도록 합니다. 어떤 워크로드인지 알려주시면 키를 보내드릴게요.",
    cta: "이메일 보내기",
    orWrite: "또는 이 주소로 메일 주세요:",
  },

  footer: {
    columns: [
      { heading: "제품", links: ["기능", "동작 방식", "문서"] },
      { heading: "오픈소스", links: ["GitHub", "엔진", "체인지로그"] },
      { heading: "회사", links: ["문의"] },
    ],
    rights: "reputation·pool",
  },
};
