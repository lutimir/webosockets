# Load test results — reference run

**Date:** 2026-07-04
**Environment:** single shared sandbox VM — 4 vCPU, 16 GB RAM, Linux 6.18.
Everything co-located on the same box: 2× SyncKit server instances
(`node dist/index.js`, ports 4201/4202), PostgreSQL 16, Redis 7 **and** the
load generators. The k6 binary cannot be installed in this environment
(registry egress is blocked), so the numbers below come from the
zero-dependency Node harness (`harness-ws.mjs`, `harness-rest.mjs`), which
measures the same end-to-end latencies as the k6 scripts.

> ⚠️ Because the generators share CPUs with the servers, client-side
> scheduling delay is _included_ in every latency figure. Numbers are
> conservative — dedicated hardware measures lower.

## REST: comments API — `harness-rest.mjs`

200 rps for 60 s against 2 instances, 75 % `POST /v1/rooms/:id/comments` /
25 % `GET …/comments?limit=20`. Every POST also fans out a realtime
`comment_created`, writes notifications and checks webhook subscriptions.

| Metric              | Target   | Measured                        |
| ------------------- | -------- | ------------------------------- |
| Achieved throughput | 200 rps  | **199.3 rps** (11 960 requests) |
| p50                 | —        | **15 ms**                       |
| p95                 | < 100 ms | **23 ms** ✅                    |
| p99                 | —        | **36 ms**                       |
| max                 | —        | 302 ms                          |
| Error rate          | < 1 %    | **0 %** (0 / 11 960) ✅         |

## WS: presence fan-out — `harness-ws.mjs`

Presence updates carry the sender's timestamp; every other room member
measures delivery latency on `presence_diff`. 50 rooms, 2 updates/s per
connection, 120 s steady state, connections split evenly across both
instances (cross-instance fan-out via Redis pub/sub).

### 500 connections (10 per room, ~9 k msg/s fan-out)

| Metric                             | Target       | Measured                  |
| ---------------------------------- | ------------ | ------------------------- |
| p50 / p95 / p99                    | p95 < 150 ms | **1 ms / 1 ms / 2 ms** ✅ |
| max                                | —            | 23 ms                     |
| Samples                            | —            | 1 065 648                 |
| Errors / drops / unexpected closes | 0            | **0 / 0 / 0** ✅          |

### 1 000 connections (20 per room, ~38 k msg/s fan-out)

Two harness processes × 500 connections, aggregated:

| Metric                             | Target       | Measured                  |
| ---------------------------------- | ------------ | ------------------------- |
| p50 / p95 / p99                    | p95 < 150 ms | **1 ms / 2 ms / 4 ms** ✅ |
| max                                | —            | 89 ms                     |
| Samples                            | —            | 4 500 541                 |
| Errors / drops / unexpected closes | 0            | **0 / 0 / 0** ✅          |

### 2 000 connections (40 per room, ~156 k msg/s fan-out) — sandbox ceiling

Four harness processes × 500 connections. The demanded fan-out
(2 000 conns × 2 upd/s × 39 receivers ≈ 156 000 msg/s) exceeds what this
4-vCPU box can move while also _hosting the generators_: latency degraded to
p50 ≈ 3.4 s / p95 ≈ 7.2 s from queueing. Notably the system stayed
**correct under saturation** — all 16.8 M expected messages were delivered,
with 0 protocol errors, 0 dropped connections and 0 unexpected closes; both
instances recovered to idle immediately after the run.

**Conclusion:** on this hardware the steady-state ceiling sits between
~38 k and ~156 k fan-out messages/s. The full 2 000-connection / 50-room
target needs generators on separate machines and more server cores — use
`k6-ws-presence.js` there. Given p95 = 2 ms at 38 k msg/s (75× under the
150 ms budget) with linear per-room fan-out cost, two 8-vCPU instances are
a realistic fit for the target; that claim should be re-verified with the
k6 script on real infrastructure before publishing numbers to customers.

## Reproduce

```bash
pnpm --filter @synckit/server build
eval "$(node load/prepare.mjs | tail -4)"
API_RATE_LIMIT_PER_MINUTE=1000000 WS_MAX_CONNECTIONS_PER_PROJECT=10000 PORT=4201 node apps/server/dist/index.js &
API_RATE_LIMIT_PER_MINUTE=1000000 WS_MAX_CONNECTIONS_PER_PROJECT=10000 PORT=4202 node apps/server/dist/index.js &

BASE_URLS=http://127.0.0.1:4201,http://127.0.0.1:4202 RPS=200 DURATION_S=60 \
  API_KEY=$LOAD_API_KEY node load/harness-rest.mjs

WS_URLS=ws://127.0.0.1:4201/v1/realtime,ws://127.0.0.1:4202/v1/realtime \
  CONNECTIONS=500 ROOMS=50 UPDATES_PER_SEC=2 DURATION_S=120 \
  PROJECT_ID=$LOAD_PROJECT_ID JWT_SECRET=$LOAD_JWT_SECRET node load/harness-ws.mjs
```
