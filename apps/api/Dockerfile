# Build from the repository root:  docker build -f apps/api/Dockerfile -t datavault-api .
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/api && bun build src/index.ts --target bun --outdir dist

FROM oven/bun:1.4-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD bun -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "dist/index.js"]
