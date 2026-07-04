import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, createConnection, type Server, type Socket } from "node:net";

import { createClient } from "@synckit/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { type Db } from "../db/client.js";
import { loadEnv, type Env } from "../env.js";
import { signClientToken } from "../lib/tokens.js";
import { createApiKey, createOrganization, createProject } from "../repos/index.js";
import { createTestDb } from "../test/db.js";
import { TestClient } from "../test/ws.js";

let db: Db;
let databaseUrl: string;
let closeTestDb: () => Promise<void>;
let env: Env;
let projectId: string;
let apiKey: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function until(probe: () => Promise<boolean> | boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  const testDb = await createTestDb();
  ({ db, databaseUrl } = testDb);
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl });
  const org = await createOrganization(db, {
    name: "Chaos",
    slug: `chaos-${randomUUID().slice(0, 8)}`,
    plan: "scale",
  });
  const project = await createProject(db, {
    organizationId: org.id,
    name: "Chaos",
    slug: "chaos",
    environment: "dev",
  });
  projectId = project.id;
  apiKey = (await createApiKey(db, { projectId, environment: "dev" })).key;
});

afterAll(async () => {
  await closeTestDb();
});

function token(endUserId: string): Promise<string> {
  return signClientToken(env.JWT_SECRET, {
    projectId,
    endUserId,
    displayName: null,
    avatarUrl: null,
  });
}

describe("chaos: Redis restart", () => {
  it("clients stay connected and fan-out recovers after Redis dies and returns", async () => {
    // The app gets its own throwaway Redis so we can kill it freely.
    const redisPort = await freePort();
    const startRedis = (): ChildProcess =>
      spawn("redis-server", ["--port", String(redisPort), "--save", "", "--appendonly", "no"], {
        stdio: "ignore",
      });
    let redis = startRedis();
    await new Promise((resolve) => setTimeout(resolve, 400));

    const app = await buildApp(
      loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      }),
    );
    await app.listen({ port: 0, host: "127.0.0.1" });

    const roomId = `chaos-redis-${randomUUID()}`;
    const alice = await TestClient.connect(app, await token("alice"));
    const bob = await TestClient.connect(app, await token("bob"));
    try {
      alice.send({ type: "join_room", roomExternalId: roomId });
      bob.send({ type: "join_room", roomExternalId: roomId });
      await alice.waitFor("room_joined");
      await bob.waitFor("room_joined");

      // Baseline: fan-out works.
      alice.send({ type: "broadcast", roomExternalId: roomId, event: "before", payload: 1 });
      await bob.waitFor("broadcast_received", (m) => m.event === "before");

      // Kill Redis hard, then bring it back on the same port.
      redis.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 500));
      redis = startRedis();

      // WS connections must have survived (liveness does not depend on Redis).
      alice.send({ type: "ping" });
      await alice.waitFor("pong");
      expect(alice.closeCode).toBeUndefined();
      expect(bob.closeCode).toBeUndefined();

      // ioredis reconnects and re-subscribes — fan-out returns.
      await until(async () => {
        alice.send({
          type: "broadcast",
          roomExternalId: roomId,
          event: "after",
          payload: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        return bob.messages.some((m) => m.type === "broadcast_received" && m.event === "after");
      }, 15_000);
    } finally {
      alice.close();
      bob.close();
      await app.close();
      redis.kill("SIGKILL");
    }
  }, 40_000);
});

describe("chaos: Postgres outage", () => {
  it("REST returns 503 + Retry-After while the DB is down; WS keeps running; recovery is automatic", async () => {
    // A TCP proxy in front of Postgres lets the test sever the DB cleanly.
    const proxyPort = await freePort();
    const target = new URL(databaseUrl);
    const sockets = new Set<Socket>();
    let acceptConnections = true;

    const makeProxy = (): Server => {
      const server = createServer((client) => {
        if (!acceptConnections) {
          client.destroy();
          return;
        }
        const upstream = createConnection({
          host: target.hostname,
          port: Number(target.port || 5432),
        });
        sockets.add(client).add(upstream);
        client.pipe(upstream).pipe(client);
        const cleanup = () => {
          sockets.delete(client);
          sockets.delete(upstream);
          client.destroy();
          upstream.destroy();
        };
        client.on("error", cleanup).on("close", cleanup);
        upstream.on("error", cleanup).on("close", cleanup);
      });
      server.listen(proxyPort, "127.0.0.1");
      return server;
    };
    const proxy = makeProxy();

    const proxiedUrl = `${target.protocol}//${target.username}:${target.password}@127.0.0.1:${proxyPort}${target.pathname}`;
    const app = await buildApp(loadEnv({ NODE_ENV: "test", DATABASE_URL: proxiedUrl }));
    await app.listen({ port: 0, host: "127.0.0.1" });

    const client = await TestClient.connect(app, await token("survivor"));
    try {
      const rest = () =>
        app.inject({
          method: "GET",
          url: "/v1/rooms",
          headers: { authorization: `Bearer ${apiKey}` },
        });

      expect((await rest()).statusCode).toBe(200);

      // Sever the database.
      acceptConnections = false;
      for (const socket of sockets) socket.destroy();

      await until(async () => (await rest()).statusCode === 503);
      const down = await rest();
      expect(down.statusCode).toBe(503);
      expect(down.headers["retry-after"]).toBe("5");

      // The realtime plane is unaffected.
      client.send({ type: "ping" });
      await client.waitFor("pong");
      expect(client.closeCode).toBeUndefined();

      // Database returns — REST recovers without a restart.
      acceptConnections = true;
      await until(async () => (await rest()).statusCode === 200, 20_000);
    } finally {
      client.close();
      await app.close();
      proxy.close();
      for (const socket of sockets) socket.destroy();
    }
  }, 40_000);
});

describe("chaos: instance replacement", () => {
  it("an SDK client reconnects to a replacement instance on the same port within 5s", async () => {
    const port = await freePort();
    const appA = await buildApp(env);
    await appA.listen({ port, host: "127.0.0.1" });

    const roomId = `chaos-replace-${randomUUID()}`;
    const client = createClient({
      url: `ws://127.0.0.1:${port}/v1/realtime`,
      tokenProvider: () => token("phoenix"),
      reconnectMinDelayMs: 100,
      reconnectMaxDelayMs: 500,
    });
    const room = client.joinRoom(roomId, { initialPresence: { alive: true } });
    await until(() => client.status === "connected");
    expect(room.presence.getMy()).toEqual({ alive: true });

    // The instance dies entirely (not just the socket)…
    await appA.close();
    await until(() => client.status === "reconnecting");

    // …and a replacement comes up on the same address, as behind an LB.
    const appB = await buildApp(env);
    await appB.listen({ port, host: "127.0.0.1" });

    const reconnectStart = Date.now();
    await until(() => client.status === "connected", 10_000);
    expect(Date.now() - reconnectStart).toBeLessThan(5_000);

    // The room was re-joined on the new instance with presence intact.
    await until(async () => {
      const presence = await appB.realtime.hub.getPresence(projectId, roomId);
      return presence.some((entry) => entry.endUserId === "phoenix");
    });

    client.disconnect();
    await appB.close();
  }, 40_000);
});
