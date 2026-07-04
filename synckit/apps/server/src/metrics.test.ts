import { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createTestDb } from "./test/db.js";

let app: FastifyInstance;
let closeTestDb: () => Promise<void>;

beforeAll(async () => {
  const testDb = await createTestDb();
  closeTestDb = testDb.close;
  app = await buildApp(loadEnv({ NODE_ENV: "test", DATABASE_URL: testDb.databaseUrl }));
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

describe("GET /metrics", () => {
  it("exposes Prometheus metrics including the SyncKit collectors", async () => {
    // Generate at least one HTTP observation first.
    await app.inject({ method: "GET", url: "/v1/openapi.json" });

    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    for (const name of [
      "synckit_ws_connections_active",
      "synckit_ws_messages_total",
      "synckit_ws_closes_total",
      "synckit_ws_dropped_messages_total",
      "synckit_broadcast_fanout_seconds",
      "synckit_http_request_duration_seconds",
      "process_cpu_user_seconds_total", // default collectors
    ]) {
      expect(response.body).toContain(name);
    }
    // Route label uses the template, not raw URLs (bounded cardinality).
    expect(response.body).toContain('route="/v1/openapi.json"');
  });
});
