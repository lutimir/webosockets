# SyncKit API server — multi-stage build ending on distroless (non-root).
# Build context is the synckit/ workspace root:
#   docker build -f apps/server/Dockerfile -t synckit-server .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile --filter @synckit/server...
RUN pnpm --filter @synckit/server... run build \
  && pnpm prune --prod \
  # pnpm leaves dev-only workspace symlink targets; drop caches for size.
  && rm -rf ~/.cache /root/.local/share/pnpm/store

# Distroless: no shell, no package manager, runs as uid 65532 (nonroot).
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app/apps/server
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 4000
# Container healthcheck (compose/k8s): /nodejs/bin/node is the distroless node.
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD \
  ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4000/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["dist/index.js"]
