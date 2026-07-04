# SyncKit demo (collaborative product board) on distroless.
# Build context is the synckit/ workspace root:
#   docker build -f apps/demo/Dockerfile -t synckit-demo .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/demo ./apps/demo
# Browser-facing WS endpoint, baked into the bundle at build time
# (e.g. wss://api.example.com/v1/realtime). Empty = ws://<host>:4000.
ARG SYNCKIT_WS_URL=""
ENV SYNCKIT_WS_URL=$SYNCKIT_WS_URL
RUN pnpm install --frozen-lockfile --filter @synckit/demo... \
  && pnpm --filter @synckit/demo... run build

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /app/apps/demo/dist ./dist
COPY --from=build /app/apps/demo/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=5173
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD \
  ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:5173/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["server.mjs"]
