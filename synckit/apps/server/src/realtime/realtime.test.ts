import { randomUUID } from "node:crypto";

import { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./../app.js";
import { type Db } from "./../db/client.js";
import { loadEnv, type Env } from "./../env.js";
import { signClientToken } from "./../lib/tokens.js";
import { createOrganization, createProject, sumUsage } from "./../repos/index.js";
import { createTestDb } from "./../test/db.js";
import { TestClient } from "./../test/ws.js";

let db: Db;
let databaseUrl: string;
let closeTestDb: () => Promise<void>;
let env: Env;
let appA: FastifyInstance;
let appB: FastifyInstance;
let projectId: string;

function room(): string {
  return `room-${randomUUID()}`;
}

async function token(endUserId: string, displayName: string | null = null): Promise<string> {
  return signClientToken(env.JWT_SECRET, { projectId, endUserId, displayName, avatarUrl: null });
}

beforeAll(async () => {
  const testDb = await createTestDb();
  ({ db, databaseUrl } = testDb);
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl });
  appA = await buildApp(env);
  appB = await buildApp(env);
  await appA.listen({ port: 0, host: "127.0.0.1" });
  await appB.listen({ port: 0, host: "127.0.0.1" });

  const org = await createOrganization(db, { name: "RT", slug: "realtime-test-org" });
  const project = await createProject(db, {
    organizationId: org.id,
    name: "RT",
    slug: "realtime-test",
    environment: "dev",
  });
  projectId = project.id;
});

afterAll(async () => {
  await Promise.allSettled([appA.close(), appB.close()]);
  await closeTestDb();
});

describe("authentication", () => {
  it("closes connections without a token with 4401", async () => {
    const client = await TestClient.connect(appA);
    expect(await client.waitForClose()).toBe(4401);
  });

  it("closes connections with a garbage token with 4401", async () => {
    const client = await TestClient.connect(appA, "not-a-jwt");
    expect(await client.waitForClose()).toBe(4401);
  });
});

describe("rooms & presence (single instance)", () => {
  it("runs the full join / update / leave lifecycle between two clients", async () => {
    const roomId = room();
    const alice = await TestClient.connect(appA, await token("alice", "Alice"));
    const bob = await TestClient.connect(appA, await token("bob", "Bob"));
    try {
      // Alice joins an empty room.
      alice.send({ type: "join_room", roomExternalId: roomId, initialPresence: { cursor: null } });
      const aliceJoined = await alice.waitFor("room_joined");
      expect(aliceJoined.presence).toEqual([]);

      // Bob joins: sees Alice; Alice gets a joined-diff about Bob.
      bob.send({ type: "join_room", roomExternalId: roomId, initialPresence: { cursor: null } });
      const bobJoined = await bob.waitFor("room_joined");
      expect(bobJoined.presence.map((p) => p.endUserId)).toEqual(["alice"]);
      expect(bobJoined.presence[0]?.displayName).toBe("Alice");

      const joinDiff = await alice.waitFor("presence_diff", (m) => m.joined.length > 0);
      expect(joinDiff.joined[0]?.endUserId).toBe("bob");
      expect(joinDiff.seq).toBeGreaterThan(aliceJoined.seq);

      // Bob moves his cursor: Alice receives the updated-diff.
      bob.send({
        type: "presence_update",
        roomExternalId: roomId,
        data: { cursor: { x: 10, y: 20 } },
      });
      const updateDiff = await alice.waitFor("presence_diff", (m) => m.updated.length > 0);
      expect(updateDiff.updated[0]?.data).toEqual({ cursor: { x: 10, y: 20 } });

      // Bob leaves: Alice receives the left-diff.
      bob.send({ type: "leave_room", roomExternalId: roomId });
      const leftDiff = await alice.waitFor("presence_diff", (m) => m.left.length > 0);
      expect(leftDiff.left).toEqual(["bob"]);

      // Leaving again is an error.
      bob.send({ type: "leave_room", roomExternalId: roomId });
      const error = await bob.waitFor("error");
      expect(error.code).toBe("not_in_room");
    } finally {
      alice.close();
      bob.close();
    }
  });

  it("requires membership for presence_update and broadcast", async () => {
    const client = await TestClient.connect(appA, await token("loner"));
    try {
      client.send({ type: "presence_update", roomExternalId: room(), data: {} });
      expect((await client.waitFor("error")).code).toBe("not_in_room");
    } finally {
      client.close();
    }
  });

  it("delivers broadcasts to other members but not the sender", async () => {
    const roomId = room();
    const alice = await TestClient.connect(appA, await token("alice"));
    const bob = await TestClient.connect(appA, await token("bob"));
    try {
      alice.send({ type: "join_room", roomExternalId: roomId });
      bob.send({ type: "join_room", roomExternalId: roomId });
      await alice.waitFor("room_joined");
      await bob.waitFor("room_joined");

      alice.send({
        type: "broadcast",
        roomExternalId: roomId,
        event: "reaction",
        payload: { emoji: "🔥" },
      });
      const received = await bob.waitFor("broadcast_received");
      expect(received).toMatchObject({
        event: "reaction",
        payload: { emoji: "🔥" },
        from: "alice",
      });

      // The sender must not receive their own broadcast.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(alice.messages.filter((m) => m.type === "broadcast_received")).toHaveLength(0);
    } finally {
      alice.close();
      bob.close();
    }
  });
});

describe("scaling across instances (shared Redis)", () => {
  it("clients on different instances see each other and survive one instance dying", async () => {
    const roomId = room();
    // A third, disposable instance plays the "crashing" node.
    const appC = await buildApp(env);
    await appC.listen({ port: 0, host: "127.0.0.1" });

    const alice = await TestClient.connect(appC, await token("alice", "Alice"));
    const bob = await TestClient.connect(appB, await token("bob", "Bob"));
    try {
      alice.send({ type: "join_room", roomExternalId: roomId });
      await alice.waitFor("room_joined");

      // Bob joins on instance B and sees Alice (presence read from Redis).
      bob.send({ type: "join_room", roomExternalId: roomId });
      const bobJoined = await bob.waitFor("room_joined");
      expect(bobJoined.presence.map((p) => p.endUserId)).toEqual(["alice"]);

      // Alice on C receives Bob's join diff via pub/sub.
      const diff = await alice.waitFor("presence_diff", (m) => m.joined.length > 0);
      expect(diff.joined[0]?.endUserId).toBe("bob");

      // Cross-instance broadcast: C → Redis → B.
      alice.send({
        type: "broadcast",
        roomExternalId: roomId,
        event: "wave",
        payload: { hi: true },
      });
      expect((await bob.waitFor("broadcast_received")).from).toBe("alice");

      // Instance C dies; Bob on B keeps working.
      const aliceClosed = alice.waitForClose();
      await appC.close();
      await aliceClosed;

      bob.send({ type: "ping" });
      await bob.waitFor("pong");
      bob.send({
        type: "broadcast",
        roomExternalId: roomId,
        event: "still-alive",
        payload: null,
      });
      // No error back means the room on B is fully functional.
      bob.send({ type: "ping" });
      await bob.waitFor("pong", (m) => m.ts > 0);
    } finally {
      alice.close();
      bob.close();
    }
  });
});

describe("limits", () => {
  it("rejects connections above the per-end-user limit with 4403", async () => {
    const limitedApp = await buildApp(
      loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        WS_MAX_CONNECTIONS_PER_END_USER: "2",
      }),
    );
    await limitedApp.listen({ port: 0, host: "127.0.0.1" });
    try {
      const userToken = await token("greedy");
      const first = await TestClient.connect(limitedApp, userToken);
      const second = await TestClient.connect(limitedApp, userToken);
      const third = await TestClient.connect(limitedApp, userToken);

      expect(await third.waitForClose()).toBe(4403);
      first.close();
      second.close();
    } finally {
      await limitedApp.close();
    }
  });

  it("rate limits chatty connections and closes repeat offenders with 4429", async () => {
    const limitedApp = await buildApp(
      loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl, WS_RATE_LIMIT_PER_SEC: "3" }),
    );
    await limitedApp.listen({ port: 0, host: "127.0.0.1" });
    try {
      const client = await TestClient.connect(limitedApp, await token("spammer"));
      for (let i = 0; i < 20; i++) client.send({ type: "ping" });

      const error = await client.waitFor("error");
      expect(error.code).toBe("rate_limited");
      expect(await client.waitForClose()).toBe(4429);
    } finally {
      await limitedApp.close();
    }
  });
});

describe("usage tracking", () => {
  it("records connection_minutes when a connection ends", async () => {
    const client = await TestClient.connect(appA, await token("metered"));
    client.send({ type: "ping" });
    await client.waitFor("pong");
    client.close();
    await client.waitForClose();

    // The usage write happens asynchronously after close — poll briefly.
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    let total = 0;
    for (let i = 0; i < 50 && total === 0; i++) {
      total = await sumUsage(db, { projectId, kind: "connection_minutes", from, to });
      if (total === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(total).toBeGreaterThanOrEqual(1);
  });
});

describe("resource cleanup", () => {
  // retry: heap measurement can wobble on loaded CI runners
  it(
    "survives 1000 connect/disconnect cycles without leaking connections, rooms or heap",
    { timeout: 120_000, retry: 1 },
    async () => {
      const roomId = room();
      const BATCH = 50;
      // Distinct end users per batch slot — stays under the per-user limit.
      const cycleTokens = await Promise.all(
        Array.from({ length: BATCH }, (_, i) => token(`churner-${i}`)),
      );

      // Warm up allocators before measuring.
      for (let i = 0; i < 50; i++) {
        const client = await TestClient.connect(appA, cycleTokens[0]);
        client.close();
        await client.waitForClose();
      }
      globalThis.gc?.();
      const heapBefore = process.memoryUsage().heapUsed;

      const CYCLES = 1_000;
      for (let done = 0; done < CYCLES; done += BATCH) {
        await Promise.all(
          cycleTokens.map(async (cycleToken) => {
            const client = await TestClient.connect(appA, cycleToken);
            client.send({ type: "join_room", roomExternalId: roomId });
            await client.waitFor("room_joined");
            client.close();
            await client.waitForClose();
          }),
        );
      }

      // Let the async close chains drain, then verify nothing is retained.
      for (let i = 0; i < 100 && appA.realtime.manager.connectionCount > 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(appA.realtime.manager.connectionCount).toBe(0);
      expect(appA.realtime.hub.roomCount).toBe(0);

      globalThis.gc?.();
      const heapAfter = process.memoryUsage().heapUsed;
      const growthMb = (heapAfter - heapBefore) / 1024 / 1024;
      expect(growthMb).toBeLessThan(25);
    },
  );
});
