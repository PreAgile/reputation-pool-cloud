# 콘솔 디자인 원칙

대상은 `dashboard/` 의 로그인 이후 화면(오버뷰·라이브 이벤트·API 키·사용량·관리자·리소스 상세)이다.
랜딩과 문서 사이트(`landing/`)는 목적이 달라 이 문서를 적용하지 않는다.

각 절에 번호가 있다. 리뷰에서 "이건 3항 위반"처럼 조항을 지목할 수 있게 하려는 것이므로, 규칙을
고치더라도 번호는 재사용하지 말고 새로 붙인다.

## 0. 출발점 — 문제는 색이 아니라 구조다

"AI 가 만든 것처럼 보이지 않게" 하려면 취향이 아니라 명시적 제약이 필요하다. 제약이 없으면 도구는
학습 데이터의 통계적 중앙값으로 수렴하고, 그 중앙값이 요즘 흔한 그 룩이다.

먼저 공정하게 평가하면, **이 레포의 시각 토큰은 그 함정에 빠져 있지 않다.**

- 폰트가 Inter/Poppins/Geist 가 아니라 Pretendard 다. 자체 호스팅이고 variable 한 파일로 45~920 을
  덮는다(`dashboard/app/fonts.ts:12-17`). 한글이 시스템 폰트로 떨어지지 않는다.
- 팔레트에 보라 그라디언트가 없다. 중립 + 단일 액센트다(`dashboard/app/globals.css:12`, `:18`).
- 상태 색이 도메인 enum 에 1:1 로 매핑된다. `--ok`/`--cool`/`--recover`/`--block` 이
  `HEALTHY`/`COOLING`/`RECOVERING`/`BLOCKLISTED` 와 정확히 대응하고
  (`dashboard/app/globals.css:23-26`, `dashboard/components/status-badge.tsx:6-11`),
  틴트 위 텍스트용 `-ink` 변형은 대비값을 실제로 계산해 주석에 남겼다(`globals.css:30-33`, 모두 ≈5.2~5.4).
  `--muted` 와 `--accent` 도 AA 미달로 검출돼 한 번 어두워진 이력이 주석에 있다(`globals.css:13`, `:16-17`).
- 다크 모드를 강제하지 않는다. `defaultTheme="system"` 이다(`dashboard/app/providers.tsx:10`).
- `prefers-reduced-motion` 을 전역에서 존중한다(`globals.css:260-270`).

즉 이 콘솔에서 손볼 것은 색·폰트가 아니다. 남은 문제는 **구조**다.

- 카드 래퍼가 균질하다. `Card` 는 예외 없이 1px 테두리 + 그림자를 붙이고(`dashboard/components/ui/card.tsx:7`)
  `app/(app)/` 안에서만 24 곳이 쓴다. 표도 카드, 폼도 카드, 에러도 카드다.
- 첫 화면이 "지금 괜찮은가?"에 한 문장으로 답하지 않는다. 오버뷰는 KPI 5 칸과 표를 준다
  (`dashboard/app/(app)/overview/page.tsx:272-295`, `:324`). 숫자는 다 있지만 판정은 사람이 한다.
- 화면마다 같은 일을 다른 모양으로 한다. 로딩은 스켈레톤과 "불러오는 중…" 한 줄이 섞여 있고,
  빈 상태는 `EmptyState` 와 회색 문장이 섞여 있고, 리소스 종류 배지는 화면에 따라 중립색이거나 accent 다.

아래 규칙은 그 구조를 고정한다. 각 항목에는 이 레포의 현재 상태를 근거로 붙였다.
"어디가 지키고 어디가 어긋났는지"까지 적어야 규칙이 지켜진다.

## 1. 한 화면 한 목적

각 화면은 **질문 하나**에 답한다. 그 질문을 화면 상단 한 문장으로 적고, 그 문장에 기여하지 않는 위젯은
다른 화면으로 보낸다.

| 화면 | 답하는 질문 | 현재 문구 |
|---|---|---|
| 오버뷰 `/overview` | 지금 괜찮은가? | `overview/page.tsx:235` "등록된 리소스의 평판 상태를 한눈에 확인합니다." |
| 라이브 이벤트 `/events` | 방금 무슨 일이 있었나? | `events/page.tsx:228-230` |
| 리소스 상세 `/resources/[kind]/[value]` | 이 리소스는 왜 이 상태가 됐나? | 없음 — 헤더가 값과 차단 버튼뿐(`resources/[kind]/[value]/page.tsx:324-354`) |
| API 키 `/keys` | 지금 살아 있는 키는 무엇이고 어느 것을 끊어야 하나? | 없음(`keys/page.tsx:161`) |
| 사용량 `/usage` | 이번 달 얼마나 썼나? | `usage/page.tsx:201` |
| 관리자 `/admin` | 테넌트와 시스템이 정상인가? | 없음(`admin/page.tsx:126`) |

오버뷰의 답은 아직 숫자다. "지금 괜찮은가?"의 답은 문장이어야 한다("차단 3 · 냉각 1 — 주의" 처럼).
현재 상단 pill 은 데이터의 신선도만 말한다(`overview/page.tsx:239-252`). 판정 문장은 후속이다.

## 2. 핵심 지표 3~5개를 좌상단에

- 지표 타일은 3~5개. 화면 전체 위젯(타일 묶음·필터 줄·표·차트를 각 1개로 셈)은 5~9개를 넘지 않는다.
- **차트를 늘려서 정보량을 늘리지 않는다.** 지표를 하나 더 넣고 싶으면 기존 지표 하나를 지운다.

현재 준수한다. 오버뷰 5 타일(`overview/page.tsx:272-295`), 사용량 3 타일(`usage/page.tsx:124-128`),
상세 4 칸(`resources/[kind]/[value]/page.tsx:358-415`). 차트는 화면당 최대 1개다
(`usage/page.tsx:136-176`, `resources/[kind]/[value]/page.tsx:431-557`).

## 3. 색은 상태에만

- 장식·강조·그라디언트에 색을 쓰지 않는다.
- 상태색(`--ok`/`--cool`/`--recover`/`--block`)은 도메인 상태를 나타낼 때만 쓴다.
- **액센트(`--accent`)는 인터랙션 가능한 요소에만.** 링크·버튼·활성 탭·포커스 링·활성 필터 칩.
- 예외 두 가지. (a) 차트 계열색 — 계열을 구분할 색이 물리적으로 필요하다
  (`usage/page.tsx:162`, `resources/[kind]/[value]/page.tsx:45`). (b) 브랜드 마크 —
  `RippleLogo` 의 블루 그라디언트 타일(`dashboard/components/marketing/logo.tsx:11`)은 로고이므로
  허용한다. 콘솔에서는 에러 화면이 `Brand` 를 통해 노출한다(`dashboard/components/error-screen.tsx:46`).
  **로고 밖으로 그라디언트를 확장하지 않는다.**

준수 근거: 상태 배지가 전부 기능색 틴트 + `-ink` 텍스트다(`status-badge.tsx:6-11`,
`events/page.tsx:21-28`, `keys/page.tsx:28-40`, `admin/page.tsx:24-43`). 토스트는 accent 를 아예 배제하고
성공/오류만 쓴다고 주석에 못박았다(`dashboard/components/ui/toast.tsx:14`).

위반: 리소스 상세의 kind 배지가 비인터랙티브인데 accent 를 쓴다
(`resources/[kind]/[value]/page.tsx:325-327`). 같은 개념을 오버뷰·이벤트는 중립색으로 그린다
(`overview/page.tsx:45-51`, `events/page.tsx:110-116`). 상세 쪽을 중립으로 맞춘다.

## 4. 숫자는 tabular-nums

표에서 자릿수가 흔들리면 스캔이 불가능해진다. 세로로 비교될 수 있는 모든 숫자에 `.tnum` 을 붙인다
(`globals.css:114-116`). **날짜·시각도 숫자다.** ID·prefix 처럼 스캔 대상인 문자열은 `font-mono` 를 함께 쓴다.

대체로 지킨다(`overview/page.tsx:371`, `events/page.tsx:352`, `resources/[kind]/[value]/page.tsx:582-591`,
`stat-tile.tsx:50`). 누락은 5항 아래 위반 목록 V6 에 있다.

## 5. 테이블 밀도를 높인다

인프라 제품의 표는 읽는 것이 아니라 스캔하는 것이다.

- 행 패딩은 `px-4 py-2.5` 로 고정한다. 현재 콘솔의 5개 표가 전부 이 값이다
  (`overview/page.tsx:353`, `events/page.tsx:352`, `keys/page.tsx:263`, `admin/page.tsx:223`,
  `resources/[kind]/[value]/page.tsx:581`). 새 표도 이 값을 쓴다.
- 여백은 **그룹 사이**에 쓴다. 행 안에서 늘리지 않는다.
- 수치 컬럼은 우측 정렬(`overview/page.tsx:332`, `resources/[kind]/[value]/page.tsx:568`).
- 긴 값은 `truncate` + `title` 로 자른다. 행 높이를 무너뜨리지 않는다(`overview/page.tsx:358-366`).

## 6. 경계선보다 여백으로 그룹

- **모든 것을 카드로 감싸지 않는다.** 카드 남용은 가장 흔한 AI 텔이다. 카드는 "여기서부터 다른 데이터
  출처"일 때만 쓴다. 같은 출처의 연속된 정보는 여백과 제목으로 나눈다.
- **카드 안 카드 금지.** 카드 안에는 표·폼·차트 같은 내용만 들어간다.
- 섹션 제목은 `<h2 className="text-sm font-bold text-ink">` 한 줄이면 된다
  (`usage/page.tsx:133`, `resources/[kind]/[value]/page.tsx:428`). 제목을 카드로 감싸지 않는다.

카드 중첩은 현재 0건이다. 다만 `Card` 자체가 항상 테두리를 붙이므로(항목 11-2) 표 하나를 감싸는 순간
"테두리 안의 테두리"가 된다. 후속 과제는 위반 목록 V2.

## 7. 3단 카드를 반사적으로 쓰지 않는다

항목 수는 **내용이** 정한다. 레이아웃이 정하지 않는다. 3개가 예뻐서 3개로 맞추지 말고, 3개밖에 없어서
3개여야 한다.

현재 통과한다. 사용량이 `sm:grid-cols-3` 인 것은(`usage/page.tsx:124`) 백엔드가 주는 지표가 실제로
3개이기 때문이다(`monthLeaseTotal`·`poolSize`·창 합계, `usage/page.tsx:125-127`). 오버뷰는 5, 상세는 4다.
숫자가 화면마다 다르다는 사실 자체가 이 규칙을 지키고 있다는 증거다.

## 8. 모션은 정보 전달만

- 허용: 상태 전이, 도착(팝오버·메뉴·모달 enter/exit), 진행(스켈레톤 맥동·라이브 dot).
- 금지: bounce/elastic 이징, 의미 없는 fade-in, 스크롤 연동 등장.
- 지속시간과 이징은 토큰만 쓴다. `--motion-fast|base|slow` 120/180/240ms, `--ease-out`/`--ease-std`
  (`globals.css:157-163`). 두 이징 모두 오버슈트 구간이 없다 — 새 이징을 추가할 때도 제어점 y 가
  0~1 을 벗어나면 안 된다.
- `prefers-reduced-motion` 은 전역 미디어쿼리가 처리한다(`globals.css:260-270`). 개별 컴포넌트가
  다시 처리할 필요는 없지만, `motion-safe:`/`motion-reduce:` 를 쓰는 것도 무방하다
  (`skeleton.tsx:13`, `overview/page.tsx:243`).

현재 모션은 전부 정보다: 메뉴/팝오버/모달 enter·exit(`globals.css:198-231`), 라이브 dot 의 확산 링
(`globals.css:236-250`, `app-shell.tsx:122`), 폴링 중임을 알리는 dot 맥동(`overview/page.tsx:243`,
`events/page.tsx:237`), 값 변경 행의 700ms 색 전이(`overview/page.tsx:349-351`).
경계 사례는 위반 목록 V15.

## 9. 빈 상태는 실제 내용으로

"데이터 없음"은 상태 보고지 화면이 아니다. 빈 상태는 **왜 비었는지 + 다음 행동**을 준다.
`EmptyState` 가 제목·설명·CTA 를 받는 이유다(`dashboard/components/ui/empty-state.tsx:7-19`).

좋은 예: API 키 목록(`keys/page.tsx:298-302` — "첫 키를 발급해 보세요" + CTA),
이벤트 목록(`events/page.tsx:389-398` — 비었을 때와 필터로 0건일 때를 구분),
사용량 차트(`usage/page.tsx:170-173` — 기간을 넓히라고 안내).

**에러도 같은 규칙을 따른다.** 에러 화면에는 반드시 재시도 경로를 준다(`EmptyState tone="error"` +
`action`). 회색 한 줄로 끝내지 않는다. 현재 혼재 상태는 위반 목록 V8·V9.

## 10. 속도가 기능이다

- 인터랙션은 즉각 반응한다. 서버 왕복을 기다리는 동안 화면이 멈춰 있으면 안 된다.
- **낙관적 갱신이 기본이다.** 뮤테이션은 UI 를 먼저 바꾸고, 실패하면 되돌리고 토스트로 알린다.
  토스트 인프라는 이미 있다(`toast.tsx:83-87`).
- **로딩은 레이아웃 시프트 없이.** 실제 레이아웃과 같은 골격의 스켈레톤을 쓴다. 오버뷰
  (`overview/page.tsx:473-495`)와 상세(`resources/[kind]/[value]/page.tsx:661-687`)가 모범이다 —
  타일 개수·차트 높이·표 행 수까지 실제와 맞춘다.
- 폴링은 탭이 보일 때만 돈다(`usePoll`, `overview/page.tsx:133`). 사용자가 멈출 수 있어야 한다
  (`overview/page.tsx:253-260`, `events/page.tsx:251-259`).

위반은 V7(스켈레톤 없는 로딩)·V13(낙관적 갱신 부재).

## 11. 금지 목록

아래 7 종은 근거를 대도 통과시키지 않는다. 각각이 "AI 텔"인 이유를 한 줄로 붙인다.

| # | 금지 | 왜 AI 텔인가 |
|---|---|---|
| 11-1 | 보라~시안 그라디언트 | 브랜드가 없을 때 도구가 고르는 기본 배색이다. 제품 정체성이 아니라 "생성물"이라고 말한다. |
| 11-2 | 모든 카드에 1px 회색 테두리 | 계층을 정하지 않고 모든 블록을 같은 무게로 만든다. 판단을 포기한 레이아웃의 흔적이다. |
| 11-3 | 좌측 컬러 스트립 | 정보 없는 색면이다. 대개 "심심해서" 붙고, 상태가 없는 타일에도 붙어 의미를 잃는다. |
| 11-4 | 지표에 그라디언트 텍스트 | 숫자는 읽히라고 있다. 그라디언트는 가독성을 깎고 대비 계산을 무의미하게 만든다. |
| 11-5 | 전면 대문자 섹션 라벨 | 라틴 기준 장식이다. 한글에는 효과가 없고, 영문 라벨만 소리치게 만들어 정보 위계를 왜곡한다. |
| 11-6 | 요청하지 않은 다크모드 강제 | 사용자 OS 설정을 무시하는 것은 "멋있어 보이려는" 선택이지 사용자의 선택이 아니다. |
| 11-7 | 글래스모피즘(반투명 + backdrop-blur) | 뒤에 뭐가 오든 대비가 흔들린다. 데이터 위에 겹치는 크롬에서는 대비 계산이 아예 불가능해진다. |

현재 상태:

- 11-1 위반 없음. 그라디언트는 브랜드 마크 1곳뿐이다(3항 예외 (b), `marketing/logo.tsx:11`).
- 11-2 **위반**. `card.tsx:7` — V2.
- 11-3 **위반**. `stat-tile.tsx:48` — V1.
- 11-4 위반 없음. 지표는 단색 토큰이다(`stat-tile.tsx:6-13`).
- 11-5 **위반**. 표 헤더·팔레트 그룹 헤딩 — V5.
- 11-6 위반 없음. `providers.tsx:10` 이 `defaultTheme="system"`, 전환은 사용자 메뉴에서만
  (`dashboard/components/user-menu.tsx:45-56`).
- 11-7 **위반**. `app-shell.tsx:267` — V3. 단, 모달 스크림의 `backdrop-blur-sm`
  (`command-palette.tsx:89`)은 예외로 허용한다. 스크림은 그 아래 내용을 **읽지 못하게** 하는 것이
  목적이므로 대비 문제가 성립하지 않는다. 상시 노출되는 크롬(상단바·사이드바·카드)에만 금지가 걸린다.

## 12. `components/ui/*` 감사 결과

2026-07-30 기준. `dashboard/components/ui/` 의 프리미티브 전부와, `ui/` 밖에 있지만 콘솔 전 화면이
공유하는 준프리미티브(`status-badge`·`sparkline`·`app-shell`)를 규칙에 대조했다. **이 문서에서는 고치지
않는다.** 코드 변경은 별도 이슈로 나간다.

### 12.1 프리미티브별 판정

| 프리미티브 | 판정 | 근거 |
|---|---|---|
| `card.tsx` | 어긋남 | 테두리+그림자가 유일한 변형이라 "카드 아님"을 표현할 수단이 없다(`:7`). 11-2 · V2 |
| `stat-tile.tsx` | 어긋남 | 좌측 컬러 스트립(`:48`), `tone="default"` 에서 `bg-line` 무의미 색면(`:7`). Card 를 쓰지 않고 카드 크롬을 복제(`:47`). 11-3 · V1 |
| `button.tsx` | 조건부 통과 | 토큰 준수(`:11-13`). 자체 문서에 "링크 안에 button 금지"를 적어 두었으나(`:5-8`) 호출부 1곳이 어긴다 — V10 |
| `empty-state.tsx` | 통과 | 제목·설명·CTA 계약(`:7-19`), 에러 톤에 `role="alert"`(`:51`). 상시 fade-in 은 경계 — V15 |
| `skeleton.tsx` | 통과 | `aria-hidden` + `motion-reduce:animate-none`(`:11-14`). 10항의 "레이아웃 시프트 없이"를 가능하게 하는 부품 |
| `tabs.tsx` | 통과 | 활성 탭에만 accent(`:37`), 모션 토큰 사용(`:36`). Radix 가 role·방향키 담당 |
| `toast.tsx` | 통과 | 기능색 2종만, accent 배제를 주석으로 고정(`:14`), success=status/polite · error=alert/assertive(`:111-112`) |
| `breadcrumb.tsx` | 통과 | 마지막 조각 `aria-current="page"`(`:27`), 구분자 `aria-hidden`(`:37`), 빈 배열이면 렌더 안 함(`:13`) |
| `dropdown-menu.tsx` | 통과 | 파괴적 항목만 상태색(`:66-70`), enter/exit 는 `rp-anim-pop` 토큰(`:48`) |
| `date-range-picker.tsx` | 통과 | 트리거·활성 프리셋이 인터랙티브라 accent 정당(`:78`, `:105`) |
| `status-badge.tsx` | 통과 | enum 4종 1:1, 틴트 위 `-ink` 텍스트(`:6-11`) |
| `sparkline.tsx` | 통과 | 성공/실패만 색으로 구분(`:33`), `role="img"` + 요약 `aria-label`(`:23-25`) |
| `app-shell.tsx` | 어긋남 | 상단바 반투명 + `backdrop-blur`(`:267`). 11-7 · V3 |

`ui/` 밖에 있으면서 `ui/` 에 있어야 할 것: `resources/[kind]/[value]/page.tsx:636-643` 의 `StatBox`
(V11), `keys/page.tsx:143`·`admin/page.tsx:120` 의 `field` 문자열(입력 필드 프리미티브 부재).

### 12.2 위반 목록

"후속" 표시는 코드 변경이 필요해 별도 이슈로 올릴 것이다. 표시 없는 항목은 다음에 그 파일을 만지는
PR 에서 함께 고친다.

| ID | 위반 | 위치 | 조항 | 비고 |
|---|---|---|---|---|
| V1 | StatTile 좌측 컬러 스트립. `tone="default"` 면 `bg-line` 이라 아무 정보도 없는 색면 | `components/ui/stat-tile.tsx:48`, 팔레트 `:6-13` | 11-3 | 후속 |
| V2 | `Card` 가 항상 1px 테두리+그림자. 표·폼·에러·CTA 가 전부 같은 무게 | `components/ui/card.tsx:7` (`app/(app)/` 내 24 사용처) | 6, 11-2 | 후속 |
| V3 | 상단바 반투명 `bg-surface/80` + `backdrop-blur` | `components/app-shell.tsx:267` | 11-7 | 후속 |
| V4 | 비인터랙티브 kind 배지에 accent. 같은 개념을 오버뷰는 중립색으로 그림 | `app/(app)/resources/[kind]/[value]/page.tsx:325-327` vs `app/(app)/overview/page.tsx:45-51` | 3 | |
| V5 | 표 헤더·그룹 헤딩 전면 대문자 | `overview/page.tsx:328`·`:458`, `events/page.tsx:339`, `keys/page.tsx:250`, `admin/page.tsx:213`, `resources/[kind]/[value]/page.tsx:566`, `components/command-palette.tsx:125`·`:143` | 11-5 | |
| V6 | 날짜·시각 셀에 `tnum` 누락. 같은 성격 컬럼이 이벤트 화면에는 붙어 있어 표마다 정렬이 다름 | `keys/page.tsx:267`, `admin/page.tsx:228`, `overview/page.tsx:378` (대조군: `events/page.tsx:352`·`:379`) | 4 | |
| V7 | 로딩이 스켈레톤 없이 텍스트 한 줄 → 데이터 도착 시 레이아웃 시프트 | `events/page.tsx:283`, `keys/page.tsx:243`, `admin/page.tsx:206`, `usage/page.tsx:112`, `resources/[kind]/[value]/page.tsx:611` | 10 | 후속 |
| V8 | 빈 상태가 `EmptyState` 대신 회색 문장. 다음 행동이 없음 | `overview/page.tsx:406-414`, `resources/[kind]/[value]/page.tsx:525-527`·`:596`·`:613` | 9 | |
| V9 | 에러 표시가 3종 혼재: `EmptyState tone="error"` / `Card`+`text-block` / 맨 텍스트. 재시도 경로 유무도 제각각 | `EmptyState`: `events/page.tsx:272-279`, `keys/page.tsx:233-240`, `admin/page.tsx:196-203`, `usage/page.tsx:96-103` · `Card`: `overview/page.tsx:266`, `resources/[kind]/[value]/page.tsx:303` · 맨 텍스트: `admin/page.tsx:191`, `resources/[kind]/[value]/page.tsx:355` | 9 | |
| V10 | `<a>` 안에 `<Button>` — `button.tsx:5-8` 이 스스로 금지한 nested-interactive | `app/(app)/usage/page.tsx:188-190` | a11y | 후속 |
| V11 | `StatBox` 로컬 재정의. `StatTile` 과 같은 일을 다른 모양(`surface-2` 박스)으로 함 | `app/(app)/resources/[kind]/[value]/page.tsx:636-643` | 2, 6 | 후속 |
| V12 | 화면이 답하는 질문 문장 없음 | `keys/page.tsx:161`, `admin/page.tsx:126`, `resources/[kind]/[value]/page.tsx:324-354` | 1 | |
| V13 | 낙관적 갱신 없음. 차단/해제가 왕복을 기다린 뒤에야 반영 | `overview/page.tsx:181-207`, `resources/[kind]/[value]/page.tsx:193-220` | 10 | 후속 |
| V14 | 값이 바뀐 행 하이라이트에 브랜드 accent 사용. accent 는 인터랙션 전용이어야 함 | `overview/page.tsx:350` | 3 | 판단 — 아래 참조 |
| V15 | `EmptyState` 가 항상 fade-in. 필터를 바꿀 때마다 재생돼 전달하는 정보가 없음 | `components/ui/empty-state.tsx:53` | 8 | 판단 — 아래 참조 |

### 12.3 뒤집힐 수 있는 판단

규칙으로 정했지만 사람이 반대 결론을 낼 수 있는 것들이다. 뒤집을 때는 이 절을 고친다.

- **V14** — "값이 바뀐 행"은 상태 전이이므로 상태색이 맞다고 볼 수도, 강조는 accent 라고 볼 수도 있다.
  여기서는 3항을 우선해 accent 를 인터랙션에만 남기고, 변경 하이라이트는 중립 강조
  (`surface-2`) 또는 전이 방향에 맞는 상태색으로 옮기는 쪽으로 정한다.
- **V15** — 비동기 도착을 알리는 fade-in 은 8항이 허용하는 "도착"이다. 다만 `EmptyState` 는 필터
  변경으로도 재마운트되므로 그때는 도착이 아니다. 최초 도착에만 재생하도록 좁히거나 없애는 쪽으로 정한다.
- **11-7 의 스크림 예외** — 글래스모피즘 금지를 문자 그대로 적용하면 `command-palette.tsx:89` 도
  위반이다. 스크림은 아래를 가리는 것이 목적이라 예외로 뒀다. 예외를 없애기로 하면 V3 와 함께
  `backdrop-blur` 를 전부 걷어내면 된다.
- **11-5 와 한글** — 표 헤더는 대부분 한글이라 `uppercase` 가 실제로는 `score`·`prefix`·`seq` 같은
  영문 컬럼에만 걸린다. "그러면 무해하다"고 볼 수도 있으나, 한 표 안에서 영문 컬럼만 대문자가 되어
  위계가 어긋나므로 위반으로 뒀다.
- **표 밀도 `py-2.5`** — 5항은 현재 코드가 이미 일치한다는 이유로 이 값을 규범으로 삼았다. 더 조밀하게
  가려면(`py-2`) 전부 함께 바꾼다. 화면마다 다른 밀도만 금지한다.
