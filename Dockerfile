# --- Build stage ---
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile
COPY . .
# `pnpm build` clears server/dist first (see server/package.json) so stale modules cannot ship.
RUN pnpm build

# --- Runtime stage ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN pnpm install --prod --frozen-lockfile --filter @deepchart/server...
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Prepare persistent data directory with proper permissions
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

# Run as non-root user for container security
USER node

ENV HOST=0.0.0.0
ENV PORT=8080
ENV STORAGE_PATH=/app/data/market_data.sqlite
# Authentication on by default: set AUTH_JWT_SECRET (32+ chars) or the container refuses to boot.
ENV AUTH_REQUIRED=1
ENV STORE_RETENTION_DAYS=30
# Candles are cheap to keep and expensive to re-pull: one year of bars, 30 days of ticks.
ENV STORE_BARS_RETENTION_DAYS=365
ENV LOG_FORMAT=json
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/dist/index.js"]
