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
      "쿨다운, 차단 목록, 리스 로직을 직접 짜지 마세요. 가장 건강한 리소스를 확보하고 결과만 보고하면 — 검증된 오픈소스 엔진이 풀을 알아서 회복시킵니다.",
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
    badge: "리소스 풀을 위한 평판 인프라",
    title: "프록시·계정 풀을 위한 평판 API.",
    bodyLead: "쿨다운, 차단 목록, 리스 로직을 직접 짜지 마세요.",
    bodyBold: "가장 건강한 리소스를 확보하고, 결과를 보고하세요",
    bodyTail: "— 검증된 오픈소스 엔진이 풀을 알아서 회복시킵니다.",
    ctaPrimary: "시작하기",
    ctaSecondary: "문서 보기",
    footnote: "완전한 오픈소스, 정형 검증된 엔진 기반",
  },

  trust: {
    heading: "신뢰는 로고가 아니라 엔진에서 나옵니다",
    items: [
      { title: "오픈소스", sub: "전체 엔진 공개(GitHub)" },
      { title: "Lincheck", sub: "선형화 가능성 증명" },
      { title: "뮤테이션 테스트", sub: "실제 버그를 잡는 테스트" },
      { title: "감사 로그", sub: "모든 결정을 기록" },
    ],
  },

  features: {
    label: "팀들이 갈아타는 이유",
    heading: "평판, 냉각, 격리 — 해결했습니다.",
    items: [
      {
        kicker: "자동 냉각·회복",
        title: "실패한 리소스는 잠시 물러났다가 스스로 복귀합니다.",
        body: "결과를 보고하면 엔진이 실패 패턴에 따라 리소스를 냉각하고 격리한 뒤, 확률 곡선에 맞춰 다시 탐침합니다 — 불량 프록시가 작업을 오염시키는 대신 스스로 회복합니다.",
        alt: "reputation-pool 대시보드 — 풀 오버뷰: 리소스별 상태·점수·최근 판정",
      },
      {
        kicker: "컨텍스트 격리",
        title: "한 컨텍스트의 실패가 다른 컨텍스트를 절대 오염시키지 않습니다.",
        body: (
          <>
            평판은 <C>resource × context</C> 셀 단위로 관리됩니다. 어느 프록시에서 <C>checkout-us</C> 가 망가져도{" "}
            <C>search-eu</C> 에는 영향이 없습니다 — 컨텍스트마다 자체 건강도와 냉각 곡선을 유지합니다.
          </>
        ),
        alt: "reputation-pool 대시보드 — 리소스 상세: 컨텍스트별 평판 곡선",
      },
      {
        kicker: "실시간 대시보드",
        title: "모든 리스·냉각·회복을 실시간으로 확인합니다.",
        body: (
          <>
            풀 상태, 평판 곡선, 라이브 이벤트 스트림 — SQL도, 추측도 필요 없습니다. 메트릭은 <C>/actuator/prometheus</C> 로
            내보내져 여러분의 Grafana 로 바로 들어갑니다.
          </>
        ),
        alt: "reputation-pool 대시보드 — 리스·냉각·회복 라이브 이벤트 스트림",
      },
    ],
  },

  caps: {
    label: "모두 기본 포함",
    heading: "실제 자동화 인프라를 위해 만들어졌습니다.",
    intro:
      "추가 구매도, 기본 기능을 풀기 위한 등급도 없습니다 — 진지한 워크로드에 필요한 인터페이스와 신호가 처음부터 함께 제공됩니다.",
    items: [
      {
        title: "gRPC & REST",
        body: "엔진 하나에 두 개의 표면 — 핫패스용 gRPC 데이터 플레인과 도구용 REST 컨트롤 플레인.",
      },
      {
        title: "라이브 이벤트 스트림",
        body: "모든 리스·냉각·차단·회복을 발생하는 순간 구독하세요.",
      },
      {
        title: "Prometheus 메트릭",
        body: (
          <>
            <C>/actuator/prometheus</C> 를 여러분의 Grafana 로 바로 스크레이프하세요.
          </>
        ),
      },
      {
        title: "감사 로그",
        body: "모든 냉각·차단·리스 결정을 내구성 있고 조회 가능한 로그에 기록합니다.",
      },
      {
        title: "컨텍스트별 평판",
        body: (
          <>
            건강도를 <C>resource × context</C> 단위로 추적합니다 — 한 컨텍스트의 실패가 다른 컨텍스트를 오염시키지
            않습니다.
          </>
        ),
      },
      {
        title: "오픈소스 엔진",
        body: "코어는 GitHub 에 Apache-2.0 으로 공개돼 있습니다. 직접 셀프호스팅하거나, 호스티드 API 를 맡기세요.",
      },
    ],
  },

  steps: {
    label: "동작 방식",
    heading: "세 번의 호출. 나머지는 엔진이 합니다.",
    intro:
      "gRPC 또는 REST 로 동작합니다 — 리소스를 한 번 등록한 뒤 컨텍스트별로 확보하고 보고하세요. 냉각·격리·회복은 여러분의 코드가 아닙니다.",
    items: [
      { title: "키 발급", body: "대시보드에서 API 키를 만들고 클라이언트를 gRPC 또는 REST 엔드포인트로 지정하세요." },
      { title: "등록 & 확보", body: "리소스를 한 번 등록한 뒤, 컨텍스트별로 가장 건강한 것을 요청하세요." },
      { title: "결과 보고", body: "무슨 일이 있었는지 풀에 알려주세요. 냉각·격리·회복은 자동입니다." },
    ],
  },

  docs: {
    label: "문서",
    heading: "5분 만에 시작합니다.",
    intro:
      "키를 발급하고, 리소스를 등록한 뒤 확보하고 보고하세요 — 퀵스타트가 전체 왕복 과정을 여러분의 언어로 안내합니다.",
    items: [
      { tag: "5분", title: "퀵스타트", body: "키 → 등록 → 확보 → 보고, 처음부터 끝까지 복붙 가능.", go: "구축 시작 →" },
      { tag: "레퍼런스", title: "API 레퍼런스", body: "6개 gRPC RPC 와 REST 컨트롤 플레인, 모든 필드 문서화.", go: "API 살펴보기 →" },
      { tag: "가이드", title: "핵심 개념", body: "평판, 냉각, 컨텍스트, 리스 — 엔진이 실제로 사고하는 방식.", go: "모델 이해하기 →" },
    ],
  },

  contact: {
    label: "접근 요청",
    heading: "팀을 하나씩 온보딩하고 있습니다.",
    body: "아직 셀프서브 가입은 없습니다 — 여러분의 풀이 건강하게 시작하도록 각 팀을 직접 설정해 드립니다. 워크로드를 알려주시면 키를 보내드리겠습니다.",
    cta: "이메일 보내기",
    orWrite: "또는 직접 메일:",
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
