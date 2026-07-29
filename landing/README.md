# landing — 랜딩·문서 (#15 계층 분리 / #16)

앱 서버와 **수명이 분리된** 정적 표면. Cloudflare Pages 로 나간다.

## 왜 대시보드에서 떼어냈나

랜딩은 누구에게나 같은 HTML 이고 DB 도 로그인도 필요 없는데, 대시보드와 같은 Next 앱 안에 라우트로
얹혀 있었다. 그래서 **앱 서버가 죽으면 제품 소개 페이지까지 같이 죽었다.** 이슈 #15 가 이걸 요구사항으로
적어 두었다:

> 포트폴리오는 면접관이 링크를 클릭하는 시점을 고를 수 없으므로 이 격리가 요구사항이다.

떼어내면 따라오는 것들:

- **장애 격리** — 서버가 사라져도 랜딩·문서·검색 색인은 산다
- **서버 부하 0** — 정적 파일은 전 세계 엣지에서 서빙된다. 2 OCPU 무료 서버에서 이건 작지 않다
- **색인 안정성** — 크롤러가 방문한 순간 서버가 다운돼 있어도 색인이 깎이지 않는다

## 경계

| 여기(Pages) | 저기(앱 서버) |
|---|---|
| 랜딩 `/`·`/ko`, 문서 | 대시보드, `/api`, `/actuator` |
| 로그인 없음, DB 없음 | 인증·테넌시·DB |
| 배포: main 머지 → Pages 자동 빌드 | 배포: GHCR → 서버 타이머가 5분 내 pull |

`components/marketing/mock/*`(스크린샷 캡처용 가짜 대시보드 화면)은 **가져오지 않았다.** 그건 대시보드
UI 를 렌더하므로 저쪽에 남는다. 랜딩은 이미 캡처된 PNG(`public/marketing/`)만 쓴다.

## 로컬 개발

```bash
corepack pnpm install
corepack pnpm dev        # http://localhost:3001 (대시보드는 3000)
corepack pnpm test
corepack pnpm build      # out/ 에 정적 파일 생성
```

포트가 다른 이유는 둘을 동시에 띄우고 링크를 오가며 확인하기 위해서다.

## 언어 자동 판별

`/` 로 들어온 방문자를 쿠키 → `Accept-Language` → 접속 국가 순으로 보고 한국어면 `/ko` 로 307 을 보낸다.
정적 내보내기에는 Next 미들웨어가 없으므로 **`functions/_middleware.ts`(Cloudflare Pages Functions)** 가
그 자리를 대신한다.

판별 **규칙**은 `lib/locale.ts` 를 그대로 재사용한다 — 이식은 입력을 얻는 방법만 바꾸는 일이어야 하고,
규칙을 다시 적으면 두 곳이 갈라진다.

## 대시보드와 공유하는 것 (복사본이다)

`app/globals.css`(디자인 토큰) · `app/fonts.ts` · `lib/cn.ts` · `lib/locale.ts` · `lib/site.ts` ·
`components/theme-toggle.tsx` · `components/ui/button.tsx`

**의도적으로 복사했다.** 공유 패키지로 묶으면 빌드가 워크스페이스에 묶여 Pages 배포가 복잡해지는데,
랜딩은 변경 빈도가 낮아 그 복잡도를 치를 값이 없다고 봤다. 대신 **색·간격 토큰을 바꿀 때는 양쪽을
고쳐야 한다** — `globals.css` 를 건드렸다면 반대쪽도 확인한다.
