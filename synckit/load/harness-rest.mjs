#!/usr/bin/env node
// Zero-dependency REST load harness (Node >= 22: global fetch).
//
// Constant arrival rate against the comments API: 75 % POST create /
// 25 % GET list, spread over the load-test rooms and BASE_URLS instances.
// Latencies go into a 1 ms histogram; exits 1 when p95 >= THRESHOLD_P95_MS
// (default 100) or the error rate exceeds 1 %.
const URLS = (process.env.BASE_URLS ?? "http://127.0.0.1:4000").split(",");
const RPS = Number(process.env.RPS ?? 200);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const ROOMS = Number(process.env.ROOMS ?? 50);
const THRESHOLD_P95_MS = Number(process.env.THRESHOLD_P95_MS ?? 100);
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("API_KEY is required (see load/prepare.mjs)");
  process.exit(2);
}

const HIST_MAX_MS = 10_000;
const histogram = new Uint32Array(HIST_MAX_MS + 1);
const stats = { samples: 0, maxMs: 0, ok: 0, failed: 0, inFlight: 0, maxInFlight: 0 };

function record(ms) {
  const bucket = Math.min(Math.max(Math.round(ms), 0), HIST_MAX_MS);
  histogram[bucket] += 1;
  stats.samples += 1;
  if (ms > stats.maxMs) stats.maxMs = ms;
}

function percentile(p) {
  if (stats.samples === 0) return null;
  const target = Math.ceil((p / 100) * stats.samples);
  let seen = 0;
  for (let ms = 0; ms <= HIST_MAX_MS; ms++) {
    seen += histogram[ms];
    if (seen >= target) return ms;
  }
  return HIST_MAX_MS;
}

let iteration = 0;

async function fire() {
  const i = iteration++;
  const base = URLS[i % URLS.length];
  const room = `load-room-${i % ROOMS}`;
  const headers = { authorization: `Bearer ${API_KEY}` };

  stats.inFlight += 1;
  stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
  const startedAt = performance.now();
  try {
    let response;
    if (i % 4 === 3) {
      response = await fetch(`${base}/v1/rooms/${room}/comments?limit=20`, { headers });
    } else {
      response = await fetch(`${base}/v1/rooms/${room}/comments`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          endUserId: `load-user-${i % 200}`,
          body: `load test comment ${i}`,
        }),
      });
    }
    await response.arrayBuffer(); // consume the body — latency includes it
    record(performance.now() - startedAt);
    if (response.ok) stats.ok += 1;
    else stats.failed += 1;
  } catch {
    stats.failed += 1;
  } finally {
    stats.inFlight -= 1;
  }
}

// Constant arrival rate: schedule a batch every 50 ms.
const TICK_MS = 50;
const perTick = (RPS * TICK_MS) / 1000;
let carry = 0;
const scheduler = setInterval(() => {
  carry += perTick;
  while (carry >= 1) {
    carry -= 1;
    void fire();
  }
}, TICK_MS);

setTimeout(() => {
  clearInterval(scheduler);
  // Let in-flight requests drain.
  setTimeout(() => {
    const total = stats.ok + stats.failed;
    const summary = {
      config: { urls: URLS, rps: RPS, durationS: DURATION_S, rooms: ROOMS },
      requests: total,
      achievedRps: Number((total / DURATION_S).toFixed(1)),
      ok: stats.ok,
      failed: stats.failed,
      errorRate: total > 0 ? Number((stats.failed / total).toFixed(4)) : null,
      maxInFlight: stats.maxInFlight,
      latencyMs: {
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
        max: Math.round(stats.maxMs),
      },
    };
    console.log(JSON.stringify(summary, null, 2));

    const p95 = summary.latencyMs.p95;
    const failedThreshold =
      p95 === null || p95 >= THRESHOLD_P95_MS || (summary.errorRate ?? 1) > 0.01;
    if (failedThreshold) {
      console.error(
        `FAIL: p95 ${p95}ms (limit ${THRESHOLD_P95_MS}ms), errors ${summary.errorRate}`,
      );
      process.exit(1);
    }
    console.error(`PASS: p95 ${p95}ms < ${THRESHOLD_P95_MS}ms, error rate ${summary.errorRate}`);
    process.exit(0);
  }, 2_000);
}, DURATION_S * 1_000);
