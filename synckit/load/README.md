# Load testing

Two interchangeable toolsets live here:

| Tool                                 | Files                                      | When to use                                                                                 |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **k6**                               | `k6-ws-presence.js`, `k6-rest-comments.js` | Real/staging infrastructure where the k6 binary can be installed.                           |
| **Node harness** (zero dependencies) | `harness-ws.mjs`, `harness-rest.mjs`       | Restricted environments (CI sandboxes, air-gapped boxes) — needs only Node ≥ 22 and `psql`. |

Both drive the same scenarios:

1. **WS presence fan-out** — N concurrent connections spread over R rooms, each
   sending presence updates at a fixed rate. Latency is measured end-to-end by
   embedding the sender's timestamp in the presence payload and reading it in
   every receiver's `presence_diff`. Target: **p95 < 150 ms**.
2. **REST comments** — constant request rate against
   `POST/GET /v1/rooms/:externalId/comments` (75 % create / 25 % list).
   Target: **p95 < 100 ms**.

Measured results from the reference run are in [`RESULTS.md`](./RESULTS.md).

## 1. Prepare fixtures

Creates an `enterprise`-plan organization (no connection caps), a project, an
API key and the load-test rooms. Prints shell exports:

```bash
node load/prepare.mjs                     # uses DATABASE_URL or the local default
eval "$(node load/prepare.mjs | tail -4)" # export LOAD_PROJECT_ID / LOAD_API_KEY / …
```

## 2. Start server instances

Run at least two instances to exercise cross-instance fan-out via Redis
pub/sub. Raise the REST rate limit — load tests are not what it protects
against:

```bash
pnpm --filter @synckit/server build
API_RATE_LIMIT_PER_MINUTE=1000000 PORT=4201 node apps/server/dist/index.js &
API_RATE_LIMIT_PER_MINUTE=1000000 PORT=4202 node apps/server/dist/index.js &
```

## 3a. Run with k6

```bash
k6 run -e WS_URLS=ws://host-a:4201/v1/realtime,ws://host-b:4202/v1/realtime \
       -e JWT_SECRET=… -e PROJECT_ID=… \
       load/k6-ws-presence.js            # 2 000 VUs, 50 rooms, 2 upd/s, 10 min

k6 run -e BASE_URLS=http://host-a:4201,http://host-b:4202 \
       -e API_KEY=sk_dev_… \
       load/k6-rest-comments.js          # 200 rps, 10 min
```

## 3b. Run with the Node harness

```bash
WS_URLS=ws://127.0.0.1:4201/v1/realtime,ws://127.0.0.1:4202/v1/realtime \
CONNECTIONS=500 ROOMS=50 UPDATES_PER_SEC=2 DURATION_S=120 \
PROJECT_ID=$LOAD_PROJECT_ID JWT_SECRET=$LOAD_JWT_SECRET \
node load/harness-ws.mjs

BASE_URLS=http://127.0.0.1:4201,http://127.0.0.1:4202 \
RPS=200 DURATION_S=60 API_KEY=$LOAD_API_KEY \
node load/harness-rest.mjs
```

Both harnesses print a JSON summary (latency percentiles, throughput, error
counts) and exit non-zero when the p95 threshold is missed.

### Caveats of the Node harness

- The load generator shares one event loop per process, so client-side
  scheduling delay is _included_ in the measured latency — numbers are
  conservative (real latency is at or below what is reported).
- For > ~1 000 connections run several harness processes in parallel and
  aggregate, or use k6.
