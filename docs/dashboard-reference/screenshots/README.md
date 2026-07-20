# screenshots/

## Cloudflare 스크린샷이 없는 이유 (의도)

- 분석 환경의 Playwright는 사용자의 Cloudflare **로그인 세션에 접근할 수 없다**(격리 브라우저, 쿠키 없음).
  남의 자격증명으로 로그인하지 않으므로 **인증된 화면을 캡처할 방법이 없다.**
- Cloudflare 대시보드는 **독점 UI 자산**이라, 캡처본을 이 저장소에 복사·재배포하지 않는다.
- 따라서 상위 분석 문서(`../cloudflare-dashboard-analysis.md`)의 Cloudflare 서술은 **라이브 관찰이 아니라
  알려진 패턴 지식**임을 명시했다.

## 대신: 우리 대시보드 스크린샷을 여기에 둔다 (근거 있는 자료)

reputation-pool-cloud 대시보드는 Playwright로 우리가 직접 캡처할 수 있다. 예:

```bash
# 백엔드(:8083)+대시보드(:3000)를 띄운 뒤 (또는 docker compose up --build → :8080)
cd dashboard
# visual 프로젝트가 오버뷰 라이트/다크 스냅샷을 이미 생성한다:
corepack pnpm test:visual --update-snapshots
# 생성물: dashboard/visual/screens.spec.ts-snapshots/overview-{light,dark}-*.png
```

- 다른 화면(상세·이벤트·사용량·관리자·키)은 #44 커버리지 확대에서 visual 스냅샷이 추가된다.
- 이 폴더에 넣을 캡처는 **민감정보(실 토큰·이메일·실계정 ID) 없이** 로컬/픽스처 데이터로 찍은 것만 둔다.
