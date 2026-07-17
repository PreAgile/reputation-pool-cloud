# reputation-pool 대시보드(#12) prod 이미지 — Next.js standalone 런타임. 패키지 매니저는 pnpm(corepack).
# Caddy(#15) 뒤에서 서빙되며 /api·/actuator는 Caddy가 app으로 라우팅하므로 이 서버는 화면만 담당한다.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# lock/워크스페이스 먼저 → 의존성 레이어 캐시(소스 변경에 무효화되지 않게).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
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
