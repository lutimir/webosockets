import { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { signClientToken } from "./lib/tokens.js";
import { createOrganization, createProject } from "./repos/index.js";
import { createTestDb } from "./test/db.js";
import { TestClient } from "./test/ws.js";

let app: FastifyInstance;
let token: string;
let closeTestDb: () => Promise<void>;

beforeAll(async () => {
  const testDb = await createTestDb();
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: testDb.databaseUrl });
  app = await buildApp(env);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const org = await createOrganization(testDb.db, { name: "T", slug: "app-test-org" });
  const project = await createProject(testDb.db, {
    organizationId: org.id,
    name: "T",
    slug: "app-test",
    environment: "dev",
  });
  token = await signClientToken(env.JWT_SECRET, {
    projectId: project.id,
    endUserId: "tester",
    displayName: "Tester",
    avatarUrl: null,
  });
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

describe("GET /healthz", () => {
  it("reports db and redis as ok when both are reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
});

describe("WS /v1/realtime basics", () => {
  it("answers ping with pong", async () => {
    const client = await TestClient.connect(app, token);
    try {
      client.send({ type: "ping" });
      const pong = await client.waitFor("pong");
      expect(pong.ts).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  it("rejects invalid messages with an error and keeps the connection open", async () => {
    const client = await TestClient.connect(app, token);
    try {
      client.socket.send("{definitely not json");
      const error = await client.waitFor("error");
      expect(error.code).toBe("invalid_message");

      client.send({ type: "ping" });
      await client.waitFor("pong");
    } finally {
      client.close();
    }
  });

  it("rejects binary frames", async () => {
    const client = await TestClient.connect(app, token);
    try {
      client.socket.send(Buffer.from([0x01, 0x02]));
      const error = await client.waitFor("error");
      expect(error.code).toBe("invalid_message");
    } finally {
      client.close();
    }
  });

  it("rejects comment_create for rooms the connection has not joined", async () => {
    const client = await TestClient.connect(app, token);
    try {
      client.send({ type: "comment_create", roomExternalId: "doc-1", body: "hi" });
      const error = await client.waitFor("error");
      expect(error.code).toBe("not_in_room");
    } finally {
      client.close();
    }
  });
});

describe("graceful shutdown", () => {
  it("closes open websocket connections on app.close()", async () => {
    const localApp = await buildApp(loadEnv({ NODE_ENV: "test" }));
    await localApp.listen({ port: 0, host: "127.0.0.1" });
    const client = await TestClient.connect(localApp, token);

    const closed = client.waitForClose();
    await localApp.close();
    expect(await closed).toBeGreaterThan(0);
  });
});
