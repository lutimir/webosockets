# Deploying SyncKit

## Topology

```
                    ┌────────────┐
   browsers ──wss──►│  LB (nginx)│──► server-a ─┐
   backends ──https►│   :8080    │──► server-b ─┤─► Postgres (managed)
                    └────────────┘              └─► Redis    (managed)
   dashboard :3000 ──► /internal on server-a (private network)
   demo      :5173 ──► /v1/tokens through the LB
```

**Sticky sessions are NOT required** — verified, not assumed: a WebSocket
pins itself to the instance that accepted it, cross-instance fan-out goes
through Redis pub/sub (multi-instance integration tests), and the SDK
reconnects to _any_ replacement instance in <5 s with presence intact
(chaos suite, `apps/server/src/chaos/chaos.test.ts`). Any L4/L7 balancer
with WebSocket upgrade support works.

## Local production-shaped run

```bash
cp .env.prod.example .env   # fill in real secrets
docker compose -f docker-compose.prod.yml up --build
# API http://localhost:8080 · dashboard http://localhost:3000 · demo http://localhost:5173
```

First-run order is handled by compose: Postgres/Redis health → `migrate`
(one-shot Drizzle migrations) → both servers → LB → dashboard/demo. To wire
the demo: register in the dashboard, create a project + API key, put it in
`.env` as `DEMO_API_KEY`, `docker compose … up -d demo`.

> Note: the container images could not be built in the CI sandbox this repo
> was developed in (Docker Hub egress is blocked there). The Dockerfiles
> follow the standard pnpm-workspace multi-stage pattern and the exact same
> artifacts they package (server `dist/`, dashboard `.next/standalone`,
> demo `dist/` + `server.mjs`) are built and integration-tested directly in
> CI — but run `docker compose -f docker-compose.prod.yml up --build` once
> on a networked machine before the first real deploy.

## Hetzner (or any VM provider)

1. **Provision**: 2× CX32 (4 vCPU) for the API, or one host running both
   containers to start. Managed Postgres 16 + Redis 7 (or a third VM —
   enable AOF persistence for Redis presence/counters).
2. **Secrets**: generate `JWT_SECRET` / `INTERNAL_API_SECRET`
   (`openssl rand -hex 32`), set `DATABASE_URL`, `REDIS_URL`,
   `DASHBOARD_ORIGIN`.
3. **TLS**: terminate at the edge — Caddy (automatic Let's Encrypt) or
   nginx + certbot in front of the LB config in `infra/nginx.conf`. WSS is
   plain TLS termination; no special handling beyond the `Upgrade` headers
   already present.
4. **Health checks**: `GET /healthz` returns `{status,db,redis}` and goes
   red when a dependency is down. Point the LB's active checks at it.
5. **Zero-downtime deploy (rolling)**: with two instances,
   `docker compose up -d --no-deps server-a` → wait for `/healthz` →
   repeat for `server-b`. Draining: the server closes sockets with 1001 on
   SIGTERM and the SDK auto-reconnects through the LB to the survivor —
   clients experience a sub-second `reconnecting` blip, no data loss
   (buffered sends replay after reconnect).
6. **Migrations**: run the `migrate` one-shot before rolling instances.
   Drizzle migrations in this repo are additive; for destructive changes
   use expand → migrate → contract across two releases.

## Fly.io

```bash
fly launch --dockerfile apps/server/Dockerfile --no-deploy   # app = synckit-api
fly postgres create && fly redis create                      # managed add-ons
fly secrets set JWT_SECRET=… INTERNAL_API_SECRET=… DATABASE_URL=… REDIS_URL=…
fly scale count 2 --region fra                               # two instances, no sticky needed
fly deploy
```

Fly's proxy supports WebSockets natively; keep `min_machines_running = 2`.
Deploy dashboard and demo as separate Fly apps from their Dockerfiles, with
`SERVER_INTERNAL_URL` pointed at the API app's internal 6PN address
(`http://synckit-api.internal:4000`) so `/internal` never crosses the
public internet.

## Backups & recovery

- **Daily logical backup**: `pg_dump -Fc` via cron/systemd timer, shipped
  to object storage (e.g. `restic`/S3), 30-day retention. Test restores
  monthly: `pg_restore --clean --if-exists -d synckit backup.dump`.
- **PITR**: managed Postgres providers include it — enable WAL archiving
  with a 7-day window; self-hosted: wal-g or pgBackRest with
  `archive_command`, base backup nightly.
- **Redis**: presence and rate/connection counters are reconstructible
  (TTL'd) — AOF `everysec` is enough; no backups required. Losing Redis
  loses in-flight fan-out only; clients resync on reconnect.
- **Restore drill**: the only stateful component is Postgres. Fresh VM +
  latest dump + `docker compose up` is a complete DR path; keep `.env` in
  your secret manager, never in the repo.

## Observability

- Prometheus: scrape `server-a:4000/metrics` and `server-b:4000/metrics`
  (private network — the LB returns 403 for `/metrics` and `/internal/`).
- Grafana: import `infra/grafana/synckit-dashboard.json` (active
  connections, msg/s, fan-out latency percentiles, WS close codes, REST
  latency/error rates, event loop lag).
- Logs are structured JSON (pino) on stdout — ship with vector/promtail.
  `authorization` headers and `?token=` params are redacted at the source.
