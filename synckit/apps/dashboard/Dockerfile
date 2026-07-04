# SyncKit dashboard — Next.js standalone output on distroless (non-root).
# Build context is the synckit/ workspace root:
#   docker build -f apps/dashboard/Dockerfile -t synckit-dashboard .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
RUN pnpm install --frozen-lockfile --filter @synckit/dashboard...
RUN pnpm --filter @synckit/dashboard... run build

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
# Standalone bundle carries its own pruned node_modules.
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD \
  ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/login').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["apps/dashboard/server.js"]
