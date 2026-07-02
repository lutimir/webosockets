# SyncKit

Real-time collaboration infrastructure — presence, comments and notifications your app can
embed in hours, not months. Built step by step according to [`../PROMPTS.md`](../PROMPTS.md).

## Repository layout

```
apps/
  server/       Fastify: WebSocket gateway + REST API
  dashboard/    Next.js customer dashboard
  demo/         Demo app using the SDK
packages/
  core/         Shared types, wire protocol, zod validation
  config/       Shared tsconfig / ESLint config
```

## Getting started

Prerequisites: Node.js ≥ 22, pnpm 10, Docker.

```bash
docker compose up -d      # Postgres 16 + Redis 7
cp .env.example .env      # defaults work for local dev
pnpm install
pnpm build
pnpm test
pnpm dev                  # server :4000, dashboard :3000, demo :5173
```

Health check: `curl http://localhost:4000/healthz` →
`{"status":"ok","db":"ok","redis":"ok"}`.

## Scripts

| Command           | What it does                      |
| ----------------- | --------------------------------- |
| `pnpm dev`        | Run all apps in watch mode        |
| `pnpm build`      | Build every package (turbo)       |
| `pnpm test`       | Unit + integration tests (vitest) |
| `pnpm lint`       | ESLint over the whole monorepo    |
| `pnpm typecheck`  | `tsc --noEmit` in every package   |
| `pnpm db:migrate` | Apply database migrations         |
| `pnpm db:seed`    | Seed local development data       |
