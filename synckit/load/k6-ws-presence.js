// k6 scenario: WS presence fan-out.
// 2 000 concurrent connections across 50 rooms, each sending 2 presence
// updates per second for 10 minutes. End-to-end latency is measured by
// embedding the sender's timestamp in the presence payload and reading it
// from every receiver's presence_diff.
//
//   k6 run -e WS_URLS=ws://a:4201/v1/realtime,ws://b:4202/v1/realtime \
//          -e JWT_SECRET=… -e PROJECT_ID=… load/k6-ws-presence.js
import { check } from "k6";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { Counter, Trend } from "k6/metrics";
import ws from "k6/ws";

const URLS = (__ENV.WS_URLS || "ws://127.0.0.1:4000/v1/realtime").split(",");
const ROOMS = Number(__ENV.ROOMS || 50);
const UPDATES_PER_SEC = Number(__ENV.UPDATES_PER_SEC || 2);
const JWT_SECRET = __ENV.JWT_SECRET;
const PROJECT_ID = __ENV.PROJECT_ID;

export const options = {
  scenarios: {
    presence: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: Number(__ENV.CONNECTIONS || 2000) },
        { duration: "10m", target: Number(__ENV.CONNECTIONS || 2000) },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    presence_latency_ms: ["p(95)<150"],
    ws_errors: ["count<100"],
  },
};

const presenceLatency = new Trend("presence_latency_ms");
const wsErrors = new Counter("ws_errors");

function base64url(input) {
  return encoding
    .b64encode(input, "rawstd")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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
      exp: now + 3600,
    }),
  );
  const signature = crypto.hmac("sha256", JWT_SECRET, `${header}.${payload}`, "base64rawurl");
  return `${header}.${payload}.${signature}`;
}

export default function () {
  const vu = __VU;
  const room = `load-room-${vu % ROOMS}`;
  const token = signToken(`k6-user-${vu}`);
  const url = `${URLS[vu % URLS.length]}?token=${encodeURIComponent(token)}`;

  const response = ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "join_room", roomExternalId: room }));
      socket.setInterval(() => {
        socket.send(
          JSON.stringify({
            type: "presence_update",
            roomExternalId: room,
            data: { x: Math.random(), y: Math.random(), t: Date.now() },
          }),
        );
      }, 1000 / UPDATES_PER_SEC);
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "presence_diff") {
        for (const entry of message.updated) {
          if (entry.data && typeof entry.data.t === "number") {
            presenceLatency.add(Date.now() - entry.data.t);
          }
        }
      } else if (message.type === "error") {
        wsErrors.add(1);
      }
    });
    socket.on("error", () => wsErrors.add(1));
    // Each iteration holds the connection for 60 s, then reconnects (ramping
    // executor keeps the target VU count constant).
    socket.setTimeout(() => socket.close(1000), 60_000);
  });

  check(response, { "ws upgrade succeeded": (r) => r && r.status === 101 });
}
