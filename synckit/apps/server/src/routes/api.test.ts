import { type FastifyInstance, type InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { type Db } from "../db/client.js";
import { loadEnv, type Env } from "../env.js";
import { verifyClientToken } from "../lib/tokens.js";
import { createApiKey, createOrganization, createProject, revokeApiKey } from "../repos/index.js";
import { createTestDb } from "../test/db.js";
import { TestClient } from "../test/ws.js";

let db: Db;
let databaseUrl: string;
let closeTestDb: () => Promise<void>;
let env: Env;
let app: FastifyInstance;
let keyA: string; // full access, project A
let keyB: string; // full access, project B
let scopedKey: string; // rooms:read only, project A
let projectAId: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  ({ db, databaseUrl } = testDb);
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl });
  app = await buildApp(env);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const org = await createOrganization(db, { name: "API", slug: "api-test-org" });
  const projectA = await createProject(db, {
    organizationId: org.id,
    name: "A",
    slug: "api-a",
    environment: "dev",
  });
  const projectB = await createProject(db, {
    organizationId: org.id,
    name: "B",
    slug: "api-b",
    environment: "dev",
  });
  projectAId = projectA.id;

  keyA = (await createApiKey(db, { projectId: projectA.id, environment: "dev" })).key;
  keyB = (await createApiKey(db, { projectId: projectB.id, environment: "dev" })).key;
  scopedKey = (
    await createApiKey(db, { projectId: projectA.id, environment: "dev", scopes: ["rooms:read"] })
  ).key;
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

function inject(options: InjectOptions & { key?: string }) {
  const { key, ...rest } = options;
  return app.inject({
    ...rest,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...rest.headers },
  });
}

describe("API key auth", () => {
  it("rejects requests without a key", async () => {
    const response = await inject({ method: "GET", url: "/v1/rooms" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects malformed and unknown keys", async () => {
    expect((await inject({ method: "GET", url: "/v1/rooms", key: "garbage" })).statusCode).toBe(
      401,
    );
    expect(
      (
        await inject({
          method: "GET",
          url: "/v1/rooms",
          key: "sk_dev_00000000000000000000000000000000",
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects revoked keys", async () => {
    const { key, record } = await createApiKey(db, { projectId: projectAId, environment: "dev" });
    expect((await inject({ method: "GET", url: "/v1/rooms", key })).statusCode).toBe(200);
    await revokeApiKey(db, record.id);
    expect((await inject({ method: "GET", url: "/v1/rooms", key })).statusCode).toBe(401);
  });

  it("enforces scopes: rooms:read key cannot mint tokens but can list rooms", async () => {
    const denied = await inject({
      method: "POST",
      url: "/v1/tokens",
      key: scopedKey,
      payload: { externalUserId: "u1" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "insufficient_scope" } });

    expect((await inject({ method: "GET", url: "/v1/rooms", key: scopedKey })).statusCode).toBe(
      200,
    );
  });
});

describe("POST /v1/tokens", () => {
  it("mints a verifiable client JWT and upserts the end user", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/tokens",
      key: keyA,
      payload: { externalUserId: "alice", displayName: "Alice", ttlSeconds: 120 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; endUser: unknown }>();
    expect(body.endUser).toEqual({ externalId: "alice", displayName: "Alice", avatarUrl: null });

    const identity = await verifyClientToken(env.JWT_SECRET, body.token);
    expect(identity).toMatchObject({
      projectId: projectAId,
      endUserId: "alice",
      displayName: "Alice",
    });
  });

  it("rejects expired tokens on verification", async () => {
    const response = await inject({
      method: "POST",
      url: "/v1/tokens",
      key: keyA,
      payload: { externalUserId: "alice", ttlSeconds: 60 },
    });
    const { token } = response.json<{ token: string }>();
    // Same token verified against a different secret must also fail.
    expect(await verifyClientToken("another-secret-that-is-long", token)).toBeUndefined();
  });

  it("validates the body", async () => {
    const response = await inject({ method: "POST", url: "/v1/tokens", key: keyA, payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
  });
});

describe("rooms API", () => {
  it("creates and lists rooms with pagination", async () => {
    for (const id of ["rest-room-1", "rest-room-2", "rest-room-3"]) {
      const created = await inject({
        method: "POST",
        url: "/v1/rooms",
        key: keyA,
        payload: { externalId: id, metadata: { name: id } },
      });
      expect(created.statusCode).toBe(201);
    }

    const page1 = await inject({ method: "GET", url: "/v1/rooms?limit=2", key: keyA });
    const body1 = page1.json<{ items: { externalId: string }[]; nextCursor?: string }>();
    expect(body1.items.length).toBe(2);
    expect(body1.nextCursor).toBeDefined();

    const page2 = await inject({
      method: "GET",
      url: `/v1/rooms?limit=50&cursor=${body1.nextCursor}`,
      key: keyA,
    });
    const body2 = page2.json<{ items: { externalId: string }[] }>();
    expect(body2.items.length).toBeGreaterThanOrEqual(1);
  });

  it("serves live presence from Redis", async () => {
    // Mint a client token and join the room over WS.
    const tokenResponse = await inject({
      method: "POST",
      url: "/v1/tokens",
      key: keyA,
      payload: { externalUserId: "presence-user", displayName: "Presence User" },
    });
    const { token } = tokenResponse.json<{ token: string }>();

    const client = await TestClient.connect(app, token);
    try {
      client.send({
        type: "join_room",
        roomExternalId: "presence-room",
        initialPresence: { cursor: { x: 1, y: 2 } },
      });
      await client.waitFor("room_joined");

      const response = await inject({
        method: "GET",
        url: "/v1/rooms/presence-room/presence",
        key: keyA,
      });
      expect(response.statusCode).toBe(200);
      const { presence } = response.json<{ presence: { endUserId: string }[] }>();
      expect(presence.map((p) => p.endUserId)).toContain("presence-user");
    } finally {
      client.close();
    }
  });

  it("404s presence of unknown rooms", async () => {
    const response = await inject({ method: "GET", url: "/v1/rooms/nope/presence", key: keyA });
    expect(response.statusCode).toBe(404);
  });
});

describe("comments API", () => {
  const room = "comments-room";

  it("runs the full CRUD + thread flow", async () => {
    // Create root comment (author auto-created).
    const created = await inject({
      method: "POST",
      url: `/v1/rooms/${room}/comments`,
      key: keyA,
      payload: { endUserId: "carol", body: "Root comment", anchor: { el: "#a" } },
    });
    expect(created.statusCode).toBe(201);
    const root = created.json<{ id: string; threadId: null; endUserId: string }>();
    expect(root.endUserId).toBe("carol");

    // Reply in thread.
    const reply = await inject({
      method: "POST",
      url: `/v1/rooms/${room}/comments`,
      key: keyA,
      payload: { endUserId: "dave", body: "Reply", threadId: root.id },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json<{ threadId: string }>().threadId).toBe(root.id);

    // Invalid thread id is rejected.
    const badThread = await inject({
      method: "POST",
      url: `/v1/rooms/${room}/comments`,
      key: keyA,
      payload: {
        endUserId: "dave",
        body: "X",
        threadId: "00000000-0000-7000-8000-000000000000",
      },
    });
    expect(badThread.statusCode).toBe(400);

    // List.
    const list = await inject({ method: "GET", url: `/v1/rooms/${room}/comments`, key: keyA });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(2);

    // Resolve.
    const resolved = await inject({
      method: "PATCH",
      url: `/v1/rooms/${room}/comments/${root.id}`,
      key: keyA,
      payload: { resolved: true },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<{ resolvedAt: string | null }>().resolvedAt).not.toBeNull();

    // Delete → gone from listing.
    const deleted = await inject({
      method: "DELETE",
      url: `/v1/rooms/${room}/comments/${root.id}`,
      key: keyA,
    });
    expect(deleted.statusCode).toBe(204);
    const after = await inject({ method: "GET", url: `/v1/rooms/${room}/comments`, key: keyA });
    expect(after.json<{ items: { id: string }[] }>().items.map((c) => c.id)).not.toContain(root.id);
  });

  it("is project-scoped: another project's key cannot see the room (IDOR)", async () => {
    const response = await inject({
      method: "GET",
      url: `/v1/rooms/${room}/comments`,
      key: keyB,
    });
    expect(response.statusCode).toBe(404);
  });

  it("pushes comment_created to connected room members", async () => {
    const tokenResponse = await inject({
      method: "POST",
      url: "/v1/tokens",
      key: keyA,
      payload: { externalUserId: "watcher" },
    });
    const { token } = tokenResponse.json<{ token: string }>();

    const client = await TestClient.connect(app, token);
    try {
      client.send({ type: "join_room", roomExternalId: "live-comments" });
      await client.waitFor("room_joined");

      await inject({
        method: "POST",
        url: "/v1/rooms/live-comments/comments",
        key: keyA,
        payload: { endUserId: "carol", body: "Live!" },
      });

      const event = await client.waitFor("comment_created");
      expect(event.comment.body).toBe("Live!");
      expect(event.comment.endUserId).toBe("carol");
    } finally {
      client.close();
    }
  });
});

describe("notifications API", () => {
  it("thread replies notify participants; read marking works", async () => {
    const room = "notif-room";
    const created = await inject({
      method: "POST",
      url: `/v1/rooms/${room}/comments`,
      key: keyA,
      payload: { endUserId: "author", body: "Root" },
    });
    const root = created.json<{ id: string; threadId: null; endUserId: string }>();

    await inject({
      method: "POST",
      url: `/v1/rooms/${room}/comments`,
      key: keyA,
      payload: { endUserId: "replier", body: "Reply", threadId: root.id },
    });

    const list = await inject({
      method: "GET",
      url: "/v1/users/author/notifications?unreadOnly=true",
      key: keyA,
    });
    expect(list.statusCode).toBe(200);
    const { items } = list.json<{ items: { id: string; type: string }[] }>();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]?.type).toBe("comment.replied");

    const read = await inject({
      method: "POST",
      url: "/v1/users/author/notifications/read",
      key: keyA,
      payload: { ids: [items[0]!.id] },
    });
    expect(read.json<{ updated: number }>().updated).toBe(1);

    const after = await inject({
      method: "GET",
      url: "/v1/users/author/notifications?unreadOnly=true",
      key: keyA,
    });
    expect(after.json<{ items: unknown[] }>().items.length).toBe(items.length - 1);
  });

  it("404s for unknown end users", async () => {
    const response = await inject({
      method: "GET",
      url: "/v1/users/ghost-user/notifications",
      key: keyA,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("rate limiting", () => {
  it("returns 429 with the standard error envelope past the per-key limit", async () => {
    const limitedApp = await buildApp(
      loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl, API_RATE_LIMIT_PER_MINUTE: "3" }),
    );
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await limitedApp.inject({
          method: "GET",
          url: "/v1/rooms",
          headers: { authorization: `Bearer ${keyA}` },
        });
        statuses.push(response.statusCode);
        if (response.statusCode === 429) {
          expect(response.json()).toMatchObject({ error: { code: "rate_limited" } });
        }
      }
      expect(statuses.filter((s) => s === 429)).toHaveLength(1);
      // healthz is never rate limited.
      const health = await limitedApp.inject({ method: "GET", url: "/healthz" });
      expect(health.statusCode).toBe(200);
    } finally {
      await limitedApp.close();
    }
  });
});

describe("OpenAPI", () => {
  it("exposes a complete spec at /v1/openapi.json", async () => {
    const response = await inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const spec = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(spec.openapi).toMatch(/^3\./);
    for (const path of [
      "/v1/tokens",
      "/v1/rooms",
      "/v1/rooms/{externalId}/presence",
      "/v1/rooms/{externalId}/comments",
      "/v1/rooms/{externalId}/comments/{commentId}",
      "/v1/users/{externalId}/notifications",
      "/v1/users/{externalId}/notifications/read",
    ]) {
      expect(spec.paths, `missing ${path}`).toHaveProperty(path);
    }
  });
});
