# reputation-pool 대시보드 (#12)

cloud 컨트롤 플레인(#11)·미터링(#10)을 소비하는 운영 대시보드. **Next.js(App Router) + Tailwind v4 + next-themes**,
시각 아이덴티티는 **Toss형**(라이트/다크, 토스 블루 하나·기능색 상태·모노 데이터). 시각 프리미티브는 shadcn 디폴트
대신 Toss 토큰으로 직접 작성.

## 실행 (로컬)

전제: 백엔드가 `:8083`에서 떠 있고 관리자 자격이 설정돼 있어야 함.

```bash
# 1) 백엔드 + DB (레포 루트)
#    REPUTATION_POOL_API_KEY, reputation-pool.admin.{username,password,jwt-secret} 설정 필요
docker compose up --build          # 또는 ./gradlew bootRun (admin 프로퍼티 주입)

# 2) 대시보드
cd dashboard
npm install
npm run dev                        # http://localhost:3000
```

`/api/*` 요청은 `next.config.ts`의 rewrite로 백엔드(`:8083`)에 프록시됩니다(브라우저 same-origin → CORS 불필요).
백엔드 주소는 `BACKEND_ORIGIN` 환경변수로 재정의 가능.

## 구조
- `app/login` — 관리자 로그인(→ `POST /api/auth/login`, JWT 발급).
- `app/(app)/*` — 보호 영역(토큰 없으면 `/login`). 셸(사이드바+토글) 안에 화면들.
  - `/` 풀 오버뷰(구현) · `/events` `/keys` `/usage` `/admin` (스텁 — 다음 단계).
- `lib/` — `api`(fetch+Bearer+ProblemDetail), `auth`(컨텍스트), `types`(REST 계약).
- `components/` — `StatusBadge`(HEALTHY/COOLING/RECOVERING/BLOCKLISTED), `AppShell`, `ThemeToggle`, `ui/*`(Toss 프리미티브).
- `app/globals.css` — Toss 디자인 토큰(라이트/다크) + Tailwind v4 `@theme`.

## v1 경계
포함: 라이트/다크, 데스크톱+태블릿. 제외: RBAC·i18n·모바일 전용·알림·자체 결제(과금 없음).
