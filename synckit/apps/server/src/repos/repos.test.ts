import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type Db } from "../db/client.js";
import { seed } from "../db/seed.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createTestDb } from "../test/db.js";

import {
  addMember,
  createApiKey,
  createComment,
  createNotification,
  createOrganization,
  createProject,
  createUser,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  getCommentById,
  getEndUserByExternalId,
  getOrganizationBySlug,
  listActiveEndpointsForEvent,
  listApiKeysByProject,
  listCommentsByRoom,
  listMembers,
  listNotificationsForEndUser,
  markNotificationsRead,
  parseApiKey,
  recordUsage,
  revokeApiKey,
  setCommentResolved,
  softDeleteComment,
  sumUsage,
  toWireComment,
  touchApiKey,
  upsertEndUser,
  upsertRoom,
  verifyApiKey,
} from "./index.js";

let db: Db;
let truncateAll: () => Promise<void>;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, truncateAll, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll();
});

async function fixtureProject() {
  const org = await createOrganization(db, { name: "Org", slug: "org" });
  const project = await createProject(db, {
    organizationId: org.id,
    name: "App",
    slug: "app",
    environment: "dev",
  });
  return { org, project };
}

describe("organizations & members", () => {
  it("creates and finds organizations by slug", async () => {
    const org = await createOrganization(db, { name: "Acme", slug: "acme", plan: "pro" });
    expect(org.plan).toBe("pro");
    expect((await getOrganizationBySlug(db, "acme"))?.id).toBe(org.id);
  });

  it("enforces unique slugs", async () => {
    await createOrganization(db, { name: "A", slug: "same" });
    await expect(createOrganization(db, { name: "B", slug: "same" })).rejects.toThrow();
  });

  it("enforces one membership per user per org", async () => {
    const org = await createOrganization(db, { name: "A", slug: "a" });
    const user = await createUser(db, { email: "x@example.com", name: "X" });
    await addMember(db, { organizationId: org.id, userId: user.id, role: "owner" });
    await expect(addMember(db, { organizationId: org.id, userId: user.id })).rejects.toThrow();
    const members = await listMembers(db, org.id);
    expect(members).toHaveLength(1);
    expect(members[0]?.user.email).toBe("x@example.com");
    expect(members[0]?.membership.role).toBe("owner");
  });

  it("enforces unique user emails", async () => {
    await createUser(db, { email: "dup@example.com", name: "A" });
    await expect(createUser(db, { email: "dup@example.com", name: "B" })).rejects.toThrow();
  });
});

describe("api keys", () => {
  it("creates a key that verifies and parses", async () => {
    const { project } = await fixtureProject();
    const { key, record } = await createApiKey(db, {
      projectId: project.id,
      environment: "dev",
      scopes: ["tokens:write"],
    });

    expect(key).toMatch(/^sk_dev_/);
    expect(parseApiKey(key)?.environment).toBe("dev");
    expect(record.scopes).toEqual(["tokens:write"]);

    const verified = await verifyApiKey(db, key);
    expect(verified?.id).toBe(record.id);
  });

  it("rejects malformed, unknown and revoked keys", async () => {
    const { project } = await fixtureProject();
    const { key, record } = await createApiKey(db, { projectId: project.id, environment: "dev" });

    expect(await verifyApiKey(db, "not-a-key")).toBeUndefined();
    expect(await verifyApiKey(db, `${key.slice(0, -4)}XXXX`)).toBeUndefined();

    await revokeApiKey(db, record.id);
    expect(await verifyApiKey(db, key)).toBeUndefined();
  });

  it("throttles last_used_at updates to once per minute", async () => {
    const { project } = await fixtureProject();
    const { record } = await createApiKey(db, { projectId: project.id, environment: "dev" });

    await touchApiKey(db, record.id);
    const [first] = await listApiKeysByProject(db, project.id);
    expect(first?.lastUsedAt).not.toBeNull();

    await touchApiKey(db, record.id); // within a minute — must not move
    const [second] = await listApiKeysByProject(db, project.id);
    expect(second?.lastUsedAt?.getTime()).toBe(first?.lastUsedAt?.getTime());
  });
});

describe("end users & rooms", () => {
  it("upserts end users by (project, externalId)", async () => {
    const { project } = await fixtureProject();
    const created = await upsertEndUser(db, {
      projectId: project.id,
      externalId: "u1",
      displayName: "Alice",
    });
    const updated = await upsertEndUser(db, {
      projectId: project.id,
      externalId: "u1",
      displayName: "Alice Renamed",
    });

    expect(updated.id).toBe(created.id);
    expect((await getEndUserByExternalId(db, project.id, "u1"))?.displayName).toBe("Alice Renamed");
  });

  it("upserts rooms idempotently", async () => {
    const { project } = await fixtureProject();
    const a = await upsertRoom(db, { projectId: project.id, externalId: "doc-1" });
    const b = await upsertRoom(db, { projectId: project.id, externalId: "doc-1" });
    expect(b.id).toBe(a.id);
  });
});

describe("comments", () => {
  async function fixtureRoom() {
    const { project } = await fixtureProject();
    const user = await upsertEndUser(db, { projectId: project.id, externalId: "u1" });
    const room = await upsertRoom(db, { projectId: project.id, externalId: "doc-1" });
    return { project, user, room };
  }

  it("supports threads, resolve and wire mapping", async () => {
    const { user, room } = await fixtureRoom();
    const root = await createComment(db, {
      roomId: room.id,
      endUserId: user.id,
      body: "Root",
      anchor: { el: "#x" },
    });
    const reply = await createComment(db, {
      roomId: room.id,
      endUserId: user.id,
      body: "Reply",
      threadId: root.id,
    });
    expect(reply.threadId).toBe(root.id);

    const resolved = await setCommentResolved(db, root.id, true);
    expect(resolved?.resolvedAt).not.toBeNull();

    const wire = toWireComment(resolved ?? root, "u1");
    expect(wire.endUserId).toBe("u1");
    expect(wire.anchor).toEqual({ el: "#x" });
    expect(wire.resolvedAt).not.toBeNull();
  });

  it("soft delete hides comments from listing but keeps the row", async () => {
    const { user, room } = await fixtureRoom();
    const comment = await createComment(db, { roomId: room.id, endUserId: user.id, body: "Bye" });

    await softDeleteComment(db, comment.id);
    expect(await getCommentById(db, comment.id)).toBeUndefined();
    expect((await listCommentsByRoom(db, room.id)).items).toHaveLength(0);

    // Double delete is a no-op.
    expect(await softDeleteComment(db, comment.id)).toBeUndefined();
  });

  it("paginates with a cursor in creation order", async () => {
    const { user, room } = await fixtureRoom();
    for (let i = 0; i < 5; i++) {
      await createComment(db, { roomId: room.id, endUserId: user.id, body: `c${i}` });
    }

    const first = await listCommentsByRoom(db, room.id, { limit: 2 });
    expect(first.items.map((c) => c.body)).toEqual(["c0", "c1"]);
    expect(first.nextCursor).toBeDefined();

    const second = await listCommentsByRoom(db, room.id, { cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((c) => c.body)).toEqual(["c2", "c3"]);

    const third = await listCommentsByRoom(db, room.id, { cursor: second.nextCursor, limit: 2 });
    expect(third.items.map((c) => c.body)).toEqual(["c4"]);
    expect(third.nextCursor).toBeUndefined();
  });
});

describe("notifications", () => {
  it("lists unread and marks read only for the owning user", async () => {
    const { project } = await fixtureProject();
    const alice = await upsertEndUser(db, { projectId: project.id, externalId: "alice" });
    const bob = await upsertEndUser(db, { projectId: project.id, externalId: "bob" });

    const n1 = await createNotification(db, { endUserId: alice.id, type: "comment.created" });
    await createNotification(db, { endUserId: alice.id, type: "comment.resolved" });

    expect(await listNotificationsForEndUser(db, alice.id, { unreadOnly: true })).toHaveLength(2);

    // Bob cannot mark Alice's notification as read.
    expect(await markNotificationsRead(db, bob.id, [n1.id])).toBe(0);
    expect(await markNotificationsRead(db, alice.id, [n1.id])).toBe(1);
    expect(await listNotificationsForEndUser(db, alice.id, { unreadOnly: true })).toHaveLength(1);
  });
});

describe("usage events", () => {
  it("sums quantities within a time range", async () => {
    const { project } = await fixtureProject();
    const base = new Date("2026-07-01T00:00:00Z");
    await recordUsage(db, {
      projectId: project.id,
      kind: "message",
      quantity: 10,
      occurredAt: base,
    });
    await recordUsage(db, {
      projectId: project.id,
      kind: "message",
      quantity: 5,
      occurredAt: new Date("2026-07-01T12:00:00Z"),
    });
    await recordUsage(db, {
      projectId: project.id,
      kind: "connection_minutes",
      quantity: 99,
      occurredAt: base,
    });
    await recordUsage(db, {
      projectId: project.id,
      kind: "message",
      quantity: 100,
      occurredAt: new Date("2026-07-03T00:00:00Z"), // outside range
    });

    const total = await sumUsage(db, {
      projectId: project.id,
      kind: "message",
      from: base,
      to: new Date("2026-07-02T00:00:00Z"),
    });
    expect(total).toBe(15);
  });
});

describe("webhook endpoints", () => {
  it("filters by subscribed event and disabled state", async () => {
    const { project } = await fixtureProject();
    const created = await createWebhookEndpoint(db, {
      projectId: project.id,
      url: "https://example.com/hook",
      events: ["comment.created"],
    });
    expect(created.secret).toMatch(/^whsec_/);

    expect(await listActiveEndpointsForEvent(db, project.id, "comment.created")).toHaveLength(1);
    expect(await listActiveEndpointsForEvent(db, project.id, "comment.resolved")).toHaveLength(0);

    await disableWebhookEndpoint(db, created.id);
    expect(await listActiveEndpointsForEvent(db, project.id, "comment.created")).toHaveLength(0);
  });
});

describe("password hashing", () => {
  it("verifies correct passwords and rejects wrong ones", async () => {
    const hash = await hashPassword("demo1234");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("demo1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("demo1234", "garbage")).toBe(false);
  });
});

describe("seed", () => {
  it("is idempotent", async () => {
    await seed(db);
    await seed(db); // second run must not fail or duplicate

    const org = await getOrganizationBySlug(db, "acme");
    expect(org).toBeDefined();
    const members = await listMembers(db, org!.id);
    expect(members).toHaveLength(1);
  });
});
