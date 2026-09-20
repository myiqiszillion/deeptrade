# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN pnpm install --prod --frozen-lockfile --filter @deepchart/server...
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# 0.0.0.0 is required so the container is reachable from outside; put auth/rate limits in
# front of it before exposing the terminal publicly.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/dist/index.js"]
