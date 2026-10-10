# --- Build stage ---
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --filter client...
COPY . .
RUN pnpm --filter client build

# --- Runtime stage ---
FROM caddy:2-alpine
COPY --from=build /app/client/dist /var/www/html
# We can just mount the config or copy it here. We'll copy it for completeness.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
