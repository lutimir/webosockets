import { describe, expect, it } from "vitest";

import {
  BROADCAST_MAX_BYTES,
  PRESENCE_MAX_BYTES,
  clientMessageSchema,
  parseClientMessage,
  parseServerMessage,
  roomExternalIdSchema,
  serverMessageSchema,
} from "./protocol.js";

describe("roomExternalIdSchema", () => {
  it("accepts typical ids", () => {
    for (const id of ["doc-123", "board:42", "a", "user_1.section"]) {
      expect(roomExternalIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("rejects empty, oversized and unsafe ids", () => {
    expect(roomExternalIdSchema.safeParse("").success).toBe(false);
    expect(roomExternalIdSchema.safeParse("x".repeat(129)).success).toBe(false);
    expect(roomExternalIdSchema.safeParse("has space").success).toBe(false);
    expect(roomExternalIdSchema.safeParse("emoji💥").success).toBe(false);
  });
});

describe("clientMessageSchema", () => {
  it("accepts join_room with and without initial presence", () => {
    expect(
      clientMessageSchema.safeParse({ type: "join_room", roomExternalId: "doc-1" }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "join_room",
        roomExternalId: "doc-1",
        initialPresence: { cursor: { x: 1, y: 2 } },
      }).success,
    ).toBe(true);
  });

  it("accepts leave_room, presence_update, broadcast, comment_create and ping", () => {
    const valid = [
      { type: "leave_room", roomExternalId: "doc-1" },
      { type: "presence_update", roomExternalId: "doc-1", data: { cursor: null } },
      { type: "broadcast", roomExternalId: "doc-1", event: "reaction", payload: { emoji: "🔥" } },
      { type: "comment_create", roomExternalId: "doc-1", body: "Looks good!" },
      { type: "ping" },
    ];
    for (const message of valid) {
      expect(clientMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("rejects unknown types and missing fields", () => {
    expect(clientMessageSchema.safeParse({ type: "explode" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "join_room" }).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: "broadcast", roomExternalId: "doc-1", event: "" })
        .success,
    ).toBe(false);
  });

  it("enforces presence payload size limit", () => {
    const oversized = { blob: "x".repeat(PRESENCE_MAX_BYTES + 1) };
    expect(
      clientMessageSchema.safeParse({
        type: "presence_update",
        roomExternalId: "doc-1",
        data: oversized,
      }).success,
    ).toBe(false);
  });

  it("enforces broadcast payload size limit", () => {
    const oversized = { blob: "x".repeat(BROADCAST_MAX_BYTES + 1) };
    expect(
      clientMessageSchema.safeParse({
        type: "broadcast",
        roomExternalId: "doc-1",
        event: "big",
        payload: oversized,
      }).success,
    ).toBe(false);
  });
});

describe("serverMessageSchema", () => {
  const presenceEntry = {
    endUserId: "u1",
    displayName: "Alice",
    avatarUrl: null,
    data: { cursor: { x: 0, y: 0 } },
  };

  it("accepts every server message type", () => {
    const valid = [
      { type: "room_joined", roomExternalId: "doc-1", seq: 0, presence: [presenceEntry] },
      {
        type: "presence_diff",
        roomExternalId: "doc-1",
        seq: 1,
        joined: [presenceEntry],
        left: ["u2"],
        updated: [],
      },
      {
        type: "broadcast_received",
        roomExternalId: "doc-1",
        seq: 2,
        event: "reaction",
        payload: { emoji: "🔥" },
        from: "u1",
      },
      {
        type: "comment_created",
        roomExternalId: "doc-1",
        seq: 3,
        comment: {
          id: "0197d4a0-3c1e-7000-8000-000000000000",
          threadId: null,
          endUserId: "u1",
          body: "hello",
          anchor: null,
          createdAt: "2026-07-02T10:00:00.000Z",
          resolvedAt: null,
        },
      },
      { type: "error", code: "rate_limited", message: "slow down" },
      { type: "pong", ts: 1_700_000_000_000 },
    ];
    for (const message of valid) {
      const result = serverMessageSchema.safeParse(message);
      expect(result.success, JSON.stringify(message)).toBe(true);
    }
  });

  it("rejects negative sequence numbers and unknown error codes", () => {
    expect(
      serverMessageSchema.safeParse({
        type: "room_joined",
        roomExternalId: "doc-1",
        seq: -1,
        presence: [],
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({ type: "error", code: "nope", message: "?" }).success,
    ).toBe(false);
  });
});

describe("parse helpers", () => {
  it("parses JSON strings", () => {
    const result = parseClientMessage(JSON.stringify({ type: "ping" }));
    expect(result).toEqual({ ok: true, message: { type: "ping" } });
  });

  it("returns an error for malformed JSON instead of throwing", () => {
    const result = parseClientMessage("{not json");
    expect(result.ok).toBe(false);
  });

  it("returns a readable error for schema violations", () => {
    const result = parseServerMessage({ type: "pong" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ts");
    }
  });
});
