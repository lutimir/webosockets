import { randomUUID } from "node:crypto";

import { createClient, type SyncKitClient } from "@synckit/client";
import { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { type Db } from "./db/client.js";
import { loadEnv, type Env } from "./env.js";
import { signClientToken } from "./lib/tokens.js";
import { createOrganization, createProject } from "./repos/index.js";
import { createTestDb } from "./test/db.js";

let db: Db;
let closeTestDb: () => Promise<void>;
let env: Env;
let app: FastifyInstance;
let wsUrl: string;
let projectId: string;
const liveClients: SyncKitClient[] = [];

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: testDb.databaseUrl });
  app = await buildApp(env);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no listen address");
  wsUrl = `ws://127.0.0.1:${address.port}/v1/realtime`;

  const org = await createOrganization(db, { name: "SDK", slug: "sdk-test-org" });
  const project = await createProject(db, {
    organizationId: org.id,
    name: "SDK",
    slug: "sdk-test",
    environment: "dev",
  });
  projectId = project.id;
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

afterEach(() => {
  for (const client of liveClients.splice(0, liveClients.length)) client.disconnect();
});

function sdk(endUserId: string, displayName?: string): SyncKitClient {
  const client = createClient({
    url: wsUrl,
    tokenProvider: () =>
      signClientToken(env.JWT_SECRET, {
        projectId,
        endUserId,
        displayName: displayName ?? null,
        avatarUrl: null,
      }),
    reconnectMinDelayMs: 50,
    reconnectMaxDelayMs: 200,
  });
  liveClients.push(client);
  return client;
}

async function until<T>(probe: () => T | undefined | false, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("SDK against a real server", () => {
  it("runs the full presence + broadcast + comments flow between two clients", async () => {
    const roomId = `sdk-room-${randomUUID()}`;
    const alice = sdk("alice", "Alice");
    const bob = sdk("bob", "Bob");

    const roomA = alice.joinRoom(roomId, { initialPresence: { cursor: null } });
    let aliceSees: { endUserId: string }[] = [];
    roomA.presence.subscribe((others) => {
      aliceSees = others;
    });
    await until(() => alice.status === "connected");

    const roomB = bob.joinRoom(roomId, { initialPresence: { cursor: { x: 1, y: 1 } } });
    await until(() => aliceSees.some((entry) => entry.endUserId === "bob"));

    // Presence update propagates.
    roomB.presence.update({ cursor: { x: 9, y: 9 } });
    await until(() => {
      const bob = aliceSees.find((entry) => entry.endUserId === "bob") as
        { data?: { cursor?: { x: number } } } | undefined;
      return bob?.data?.cursor?.x === 9;
    });

    // Broadcast reaches the other member only.
    const bobReceived: unknown[] = [];
    roomB.broadcast.on("reaction", (payload, from) => bobReceived.push({ payload, from }));
    roomA.broadcast.emit("reaction", { emoji: "🔥" });
    await until(() => bobReceived.length === 1);
    expect(bobReceived[0]).toEqual({ payload: { emoji: "🔥" }, from: "alice" });

    // Comments: create → realtime event; list; resolve → updated event.
    const createdSeen: string[] = [];
    roomB.comments.on("created", (comment) => createdSeen.push(comment.body));

    const comment = await roomA.comments.create({ body: "Ship it", anchor: { el: "#btn" } });
    expect(comment.endUserId).toBe("alice");
    await until(() => createdSeen.includes("Ship it"));

    const page = await roomB.comments.list();
    expect(page.items.map((item) => item.body)).toContain("Ship it");

    const resolved = await roomB.comments.resolve(comment.id);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("pushes notifications to the thread's participants in realtime", async () => {
    const roomId = `sdk-notif-${randomUUID()}`;
    const bob = sdk("bob", "Bob");
    const carol = sdk("carol", "Carol");

    const notifications: string[] = [];
    bob.notifications.subscribe((notification) => notifications.push(notification.type));

    const roomB = bob.joinRoom(roomId);
    await until(() => bob.status === "connected");
    const root = await roomB.comments.create({ body: "Root comment" });

    const roomC = carol.joinRoom(roomId);
    await until(() => carol.status === "connected");
    await roomC.comments.create({ body: "A reply", threadId: root.id });

    await until(() => notifications.includes("comment.replied"));
  });

  it("recovers from a dead connection: reconnect, re-join and presence restore in <5s", async () => {
    const roomId = `sdk-reconnect-${randomUUID()}`;
    const alice = sdk("alice", "Alice");
    const watcher = sdk("watcher");

    let watcherSees: { endUserId: string }[] = [];
    watcher.joinRoom(roomId).presence.subscribe((others) => {
      watcherSees = others;
    });

    const roomA = alice.joinRoom(roomId, { initialPresence: { step: 0 } });
    await until(() => watcherSees.some((entry) => entry.endUserId === "alice"));
    roomA.presence.update({ step: 42 });

    // Kill every socket server-side (simulates an LB/instance failure).
    const statuses: string[] = [];
    alice.on("status", (status) => statuses.push(status));
    app.realtime.manager.terminateAllSockets();

    await until(() => statuses.includes("reconnecting"));
    const reconnectStart = Date.now();
    await until(() => alice.status === "connected");
    expect(Date.now() - reconnectStart).toBeLessThan(5_000);

    // Presence was re-published with the LATEST value after the re-join.
    await until(() => {
      const entry = watcherSees.find((other) => other.endUserId === "alice") as
        { data?: { step?: number } } | undefined;
      return entry?.data?.step === 42;
    });

    const presence = await app.realtime.hub.getPresence(projectId, roomId);
    expect(presence.map((entry) => entry.endUserId)).toContain("alice");
  });

  it("flushes broadcasts buffered while offline once reconnected", async () => {
    const roomId = `sdk-buffer-${randomUUID()}`;
    // Bob listens on a second server instance (shared Redis) so that killing
    // Alice's sockets cannot make him miss the flushed broadcast.
    const appB = await buildApp(env);
    await appB.listen({ port: 0, host: "127.0.0.1" });
    const addressB = appB.server.address();
    if (addressB === null || typeof addressB === "string") throw new Error("no listen address");

    const alice = sdk("alice");
    const bob = createClient({
      url: `ws://127.0.0.1:${addressB.port}/v1/realtime`,
      tokenProvider: () =>
        signClientToken(env.JWT_SECRET, {
          projectId,
          endUserId: "bob",
          displayName: null,
          avatarUrl: null,
        }),
      reconnectMinDelayMs: 50,
      reconnectMaxDelayMs: 200,
    });
    liveClients.push(bob);

    try {
      const received: unknown[] = [];
      bob.joinRoom(roomId).broadcast.on("queued", (payload) => received.push(payload));
      const roomA = alice.joinRoom(roomId);
      await until(() => alice.status === "connected" && bob.status === "connected");

      app.realtime.manager.terminateAllSockets(); // kills Alice only
      await until(() => alice.status === "reconnecting");
      roomA.broadcast.emit("queued", { sent: "offline" }); // → offline buffer

      await until(() => received.length === 1, 8_000);
      expect(received[0]).toEqual({ sent: "offline" });
    } finally {
      bob.disconnect();
      await appB.close();
    }
  });

  it("refreshes the token via tokenProvider after a 4401 close", async () => {
    let calls = 0;
    const client = createClient({
      url: wsUrl,
      tokenProvider: async () => {
        calls += 1;
        if (calls === 1) return "definitely-not-a-jwt";
        return signClientToken(env.JWT_SECRET, {
          projectId,
          endUserId: "late-bloomer",
          displayName: null,
          avatarUrl: null,
        });
      },
      reconnectMinDelayMs: 50,
      reconnectMaxDelayMs: 200,
    });
    liveClients.push(client);

    client.connect();
    await until(() => client.status === "connected");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
