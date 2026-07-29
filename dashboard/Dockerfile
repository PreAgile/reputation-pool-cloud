# reputation-pool 대시보드(#12) prod 이미지 — Next.js standalone 런타임. 패키지 매니저는 pnpm(corepack).
# Caddy(#15) 뒤에서 서빙되며 /api·/actuator는 Caddy가 app으로 라우팅하므로 이 서버는 화면만 담당한다.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# lock/워크스페이스 먼저 → 의존성 레이어 캐시(소스 변경에 무효화되지 않게).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# 랜딩이 사는 곳(apex). 이 이미지가 서빙하는 오리진이 아니라 **바깥으로 내보내는 링크**의 목적지다 —
# 404 의 "홈으로", 502 화면의 CTA(dashboard/lib/site.ts).
# `NEXT_PUBLIC_*` 는 빌드 시점에 산출물로 인라인되므로 런타임 환경변수로는 바꿀 수 없다 — 반드시 build arg
# 로 넣어야 한다(CI 는 release.yml 의 build-args). 여기가 비어 있으면 값을 덮을 방법이 아예 없어져서,
# apex 가 다른 배포(staging 등)는 앱이 죽은 순간 사용자에게 **남의 도메인**을 탈출구로 준다.
ARG NEXT_PUBLIC_LANDING_URL=https://poolroost.com
ENV NEXT_PUBLIC_LANDING_URL=$NEXT_PUBLIC_LANDING_URL
RUN pnpm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# standalone 서버가 모든 인터페이스에 바인딩하도록(기본은 localhost).
ENV HOSTNAME=0.0.0.0
# standalone 산출물만 담는다: server.js + 최소 node_modules + 정적 자산 + public.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
