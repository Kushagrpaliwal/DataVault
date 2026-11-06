# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t datavault-web \
#     --build-arg VITE_API_URL=https://app.example.org --build-arg VITE_WEB_URL=https://app.example.org .
FROM oven/bun:1.4 AS build
ARG VITE_API_URL
ARG VITE_WEB_URL
ENV VITE_API_URL=$VITE_API_URL VITE_WEB_URL=$VITE_WEB_URL
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/web && bun run build

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
