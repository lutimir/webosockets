#!/usr/bin/env node
// Zero-dependency WS presence load harness (Node >= 22: global WebSocket).
//
// Opens CONNECTIONS sockets spread over ROOMS rooms and WS_URLS instances.
// Every client sends UPDATES_PER_SEC presence updates carrying `t: Date.now()`;
// every *other* room member measures end-to-end latency from `t` on receiving
// the presence_diff. Latencies land in a 1 ms-resolution histogram so memory
// stays flat regardless of scale.
//
// Exits 1 when p95 exceeds THRESHOLD_P95_MS (default 150).
import { createHmac } from "node:crypto";

const URLS = (process.env.WS_URLS ?? "ws://127.0.0.1:4000/v1/realtime").split(",");
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 500);
/** Client index offset — lets several harness processes share one room set. */
const OFFSET = Number(process.env.OFFSET ?? 0);
const ROOMS = Number(process.env.ROOMS ?? 50);
const UPDATES_PER_SEC = Number(process.env.UPDATES_PER_SEC ?? 2);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const THRESHOLD_P95_MS = Number(process.env.THRESHOLD_P95_MS ?? 150);
const PROJECT_ID = process.env.PROJECT_ID;
const JWT_SECRET = process.env.JWT_SECRET;

if (!PROJECT_ID || !JWT_SECRET) {
  console.error("PROJECT_ID and JWT_SECRET are required (see load/prepare.mjs)");
  process.exit(2);
}

const base64url = (value) => Buffer.from(value).toString("base64url");

function signToken(endUserId) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: endUserId,
      projectId: PROJECT_ID,
      displayName: null,
      avatarUrl: null,
      iat: now,
      exp: now + 3600 + DURATION_S,
    }),
  );
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// ─── Histogram (1 ms buckets up to 10 s) ─────────────────────────────────────
const HIST_MAX_MS = 10_000;
const histogram = new Uint32Array(HIST_MAX_MS + 1);
const stats = {
  samples: 0,
  maxMs: 0,
  updatesSent: 0,
  diffsReceived: 0,
  joins: 0,
  connectFailures: 0,
  serverErrors: 0,
  unexpectedCloses: 0,
};

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

// ─── Clients ─────────────────────────────────────────────────────────────────
const sockets = [];
const timers = [];
let stopping = false;

function startClient(rawIndex) {
  const index = rawIndex + OFFSET;
  const room = `load-room-${index % ROOMS}`;
  const token = signToken(`load-user-${index}`);
  const url = `${URLS[index % URLS.length]}?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(url);
  sockets.push(socket);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join_room", roomExternalId: room }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "room_joined") {
      stats.joins += 1;
      // Jitter the send phase so updates spread evenly over the second.
      const timer = setInterval(
        () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({
              type: "presence_update",
              roomExternalId: room,
              data: { x: Math.random(), y: Math.random(), t: Date.now() },
            }),
          );
          stats.updatesSent += 1;
        },
        1000 / UPDATES_PER_SEC + Math.random() * 20,
      );
      timers.push(timer);
    } else if (message.type === "presence_diff") {
      stats.diffsReceived += 1;
      for (const entry of message.updated) {
        if (entry.data && typeof entry.data.t === "number") record(Date.now() - entry.data.t);
      }
    } else if (message.type === "error") {
      stats.serverErrors += 1;
    }
  });
  socket.addEventListener("error", () => {
    stats.connectFailures += 1;
  });
  socket.addEventListener("close", (event) => {
    if (!stopping && event.code !== 1000) stats.unexpectedCloses += 1;
  });
}

// Ramp connections in over ~5 s to avoid a thundering herd.
const rampMs = Math.min(5_000, CONNECTIONS * 5);
for (let i = 0; i < CONNECTIONS; i++) {
  setTimeout(() => startClient(i), (i / CONNECTIONS) * rampMs);
}

setTimeout(
  () => {
    stopping = true;
    for (const timer of timers) clearInterval(timer);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000);
    }

    const summary = {
      config: {
        urls: URLS,
        connections: CONNECTIONS,
        rooms: ROOMS,
        updatesPerSec: UPDATES_PER_SEC,
        durationS: DURATION_S,
      },
      ...stats,
      latencyMs: {
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
        max: Math.round(stats.maxMs),
      },
    };
    console.log(JSON.stringify(summary, null, 2));

    const p95 = summary.latencyMs.p95;
    if (p95 === null || p95 >= THRESHOLD_P95_MS) {
      console.error(`FAIL: presence p95 ${p95}ms >= ${THRESHOLD_P95_MS}ms`);
      process.exitCode = 1;
    } else {
      console.error(`PASS: presence p95 ${p95}ms < ${THRESHOLD_P95_MS}ms`);
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 1_000).unref();
  },
  rampMs + DURATION_S * 1_000,
);
