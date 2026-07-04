import { type ServerMessage } from "@synckit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBackoffDelay } from "./backoff.js";

import { createClient, type SyncKitClient } from "./index.js";

// Unsigned test JWT with sub "me" (header.payload.signature, base64url).
function fakeToken(sub = "me"): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ sub })}.sig`;
}

/** Scriptable stand-in for the WebSocket API. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static latest(): FakeWebSocket {
    const instance = FakeWebSocket.instances.at(-1);
    if (!instance) throw new Error("no FakeWebSocket created yet");
    return instance;
  }

  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  private listeners = new Map<string, ((event: never) => void)[]>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closedWith = code;
    this.serverClose(code ?? 1_000);
  }

  // ── test controls ──
  serverOpen(): void {
    this.readyState = 1;
    this.fire("open", {});
  }
  serverMessage(message: ServerMessage): void {
    this.fire("message", { data: JSON.stringify(message) });
  }
  serverClose(code: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close", { code, reason: "" });
  }
  sentMessages(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw) as { type: string });
  }

  private fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (event: unknown) => void)(event);
    }
  }
}

let tokenCalls: number;
let client: SyncKitClient;

function makeClient(tokenProvider?: () => string): SyncKitClient {
  tokenCalls = 0;
  return createClient({
    url: "ws://fake/v1/realtime",
    tokenProvider:
      tokenProvider ??
      (() => {
        tokenCalls += 1;
        return fakeToken();
      }),
    WebSocketImpl: FakeWebSocket,
    reconnectMinDelayMs: 10,
    reconnectMaxDelayMs: 50,
    offlineBufferSize: 5,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  client = makeClient();
});

afterEach(() => {
  client.disconnect();
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("state machine", () => {
  it("walks idle → connecting → connected and emits status events", async () => {
    const statuses: string[] = [];
    client.on("status", (status) => statuses.push(status));
    expect(client.status).toBe("idle");

    client.connect();
    await settle();
    expect(client.status).toBe("connecting");

    FakeWebSocket.latest().serverOpen();
    expect(client.status).toBe("connected");
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  it("reconnects with backoff after an unexpected close and re-joins rooms", async () => {
    const room = client.joinRoom("doc-1", { initialPresence: { cursor: null } });
    await settle();
    const first = FakeWebSocket.latest();
    first.serverOpen();
    expect(first.sentMessages().map((m) => m.type)).toContain("join_room");

    room.presence.update({ cursor: { x: 5, y: 6 } });

    first.serverClose(1_006);
    expect(client.status).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(100); // past max backoff
    const second = FakeWebSocket.latest();
    expect(second).not.toBe(first);
    second.serverOpen();
    expect(client.status).toBe("connected");

    // Rejoin carries the LATEST presence, not the initial one.
    const rejoin = second.sentMessages().find((m) => m.type === "join_room");
    expect(rejoin?.initialPresence).toEqual({ cursor: { x: 5, y: 6 } });
  });

  it("join_room precedes requests issued by status subscribers", async () => {
    // Regression: a "connected" subscriber that immediately fires a request
    // (like a comments fetch) must not race ahead of join_room.
    const room = client.joinRoom("doc-1");
    client.on("status", (status) => {
      if (status === "connected") void room.comments.list().catch(() => undefined);
    });
    await settle();
    FakeWebSocket.latest().serverOpen();
    await settle();

    const types = FakeWebSocket.latest()
      .sentMessages()
      .map((message) => message.type);
    expect(types.indexOf("join_room")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("comment_list")).toBeGreaterThan(types.indexOf("join_room"));
  });

  it("disconnect() closes permanently — no reconnect is scheduled", async () => {
    client.connect();
    await settle();
    FakeWebSocket.latest().serverOpen();

    client.disconnect();
    expect(client.status).toBe("closed");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("fetches a fresh token on every reconnect (4401 recovery)", async () => {
    client.connect();
    await settle();
    expect(tokenCalls).toBe(1);

    FakeWebSocket.latest().serverClose(4_401);
    await vi.advanceTimersByTimeAsync(100);
    expect(tokenCalls).toBe(2);
  });

  it("retries when the token provider itself fails", async () => {
    let calls = 0;
    client = makeClient(() => {
      calls += 1;
      if (calls === 1) throw new Error("backend down");
      return fakeToken();
    });
    const errors: string[] = [];
    client.on("error", (error) => errors.push(error.code));

    client.connect();
    await settle();
    expect(errors).toContain("token_provider_failed");

    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("offline buffer", () => {
  it("buffers broadcasts while disconnected and flushes after (re)connect", async () => {
    const room = client.joinRoom("doc-1");
    room.broadcast.emit("hello", { n: 1 }); // still connecting — buffered
    await settle();

    const socket = FakeWebSocket.latest();
    socket.serverOpen();

    const types = socket.sentMessages().map((m) => m.type);
    // join first, then the flushed broadcast
    expect(types.indexOf("join_room")).toBeLessThan(types.indexOf("broadcast"));
  });

  it("caps the buffer and drops the oldest messages", async () => {
    const room = client.joinRoom("doc-1");
    await settle();
    for (let i = 0; i < 8; i++) room.broadcast.emit("e", { i }); // cap is 5

    FakeWebSocket.latest().serverOpen();
    const broadcasts = FakeWebSocket.latest()
      .sentMessages()
      .filter((m) => m.type === "broadcast");
    expect(broadcasts).toHaveLength(5);
    const first = broadcasts[0] as unknown as { payload: { i: number } };
    expect(first.payload.i).toBe(3); // 0-2 dropped
  });
});

describe("presence & seq handling", () => {
  async function connectedRoom() {
    const room = client.joinRoom("doc-1");
    await settle();
    const socket = FakeWebSocket.latest();
    socket.serverOpen();
    socket.serverMessage({ type: "room_joined", roomExternalId: "doc-1", seq: 1, presence: [] });
    return { room, socket };
  }

  it("tracks others and never includes self", async () => {
    const { room, socket } = await connectedRoom();
    const snapshots: unknown[][] = [];
    room.presence.subscribe((others) => snapshots.push(others));

    socket.serverMessage({
      type: "presence_diff",
      roomExternalId: "doc-1",
      seq: 3, // seq 2 was our own join diff — no resync
      joined: [
        { endUserId: "alice", displayName: "Alice", avatarUrl: null, data: null },
        { endUserId: "me", displayName: "Me", avatarUrl: null, data: null },
      ],
      left: [],
      updated: [],
    });

    const latest = snapshots.at(-1) as { endUserId: string }[];
    expect(latest.map((entry) => entry.endUserId)).toEqual(["alice"]);
    // No spurious rejoin happened.
    expect(socket.sentMessages().filter((m) => m.type === "join_room")).toHaveLength(1);
  });

  it("resyncs (re-joins) when more seqs are missing than we produced", async () => {
    const { socket } = await connectedRoom();

    socket.serverMessage({
      type: "presence_diff",
      roomExternalId: "doc-1",
      seq: 9, // gap of 7 with only 1 own outstanding seq → data was lost
      joined: [],
      left: [],
      updated: [],
    });

    expect(socket.sentMessages().filter((m) => m.type === "join_room")).toHaveLength(2);
  });

  it("ignores stale (already seen) seqs", async () => {
    const { room, socket } = await connectedRoom();
    const events: unknown[] = [];
    room.broadcast.on("x", (payload) => events.push(payload));

    socket.serverMessage({
      type: "broadcast_received",
      roomExternalId: "doc-1",
      seq: 1, // duplicate of room_joined seq
      event: "x",
      payload: { stale: true },
      from: "alice",
    });
    expect(events).toHaveLength(0);
  });
});

describe("backoff", () => {
  it("grows exponentially within [min/2·2^n, min·2^n] capped at max", () => {
    const options = { minDelayMs: 1_000, maxDelayMs: 30_000 };
    expect(computeBackoffDelay(0, options, () => 1)).toBe(1_000);
    expect(computeBackoffDelay(0, options, () => 0)).toBe(500);
    expect(computeBackoffDelay(3, options, () => 1)).toBe(8_000);
    expect(computeBackoffDelay(10, options, () => 1)).toBe(30_000); // capped
    expect(computeBackoffDelay(10, options, () => 0)).toBe(15_000);
  });
});
