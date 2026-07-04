import { describe, expect, it, vi } from "vitest";
import { type WebSocket } from "ws";

import { ConnectionManager, TokenBucket } from "./connection-manager.js";

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  silent: () => undefined,
  level: "silent",
  child: () => silentLog,
  // Minimal pino-compatible surface for tests.
} as never;

function fakeSocket(bufferedAmount = 0) {
  const socket = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
  };
  return socket as unknown as WebSocket & typeof socket;
}

function makeManager() {
  return new ConnectionManager({
    maxPerEndUser: 5,
    maxPerProject: 100,
    rateLimitPerSec: 50,
    backpressureSoftBytes: 1_000,
    backpressureHardBytes: 5_000,
    log: silentLog,
  });
}

const identity = {
  projectId: "00000000-0000-7000-8000-000000000000",
  endUserId: "u1",
  displayName: null,
  avatarUrl: null,
};

describe("backpressure in deliver()", () => {
  it("sends normally below the soft limit", () => {
    const manager = makeManager();
    const socket = fakeSocket(0);
    const result = manager.register(socket, identity);
    if (!result.ok) throw new Error("register failed");

    manager.deliver(result.connection, { type: "pong", ts: 1 });
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("drops messages above the soft limit and notifies exactly once", () => {
    const manager = makeManager();
    const socket = fakeSocket(2_000); // above soft, below hard
    const result = manager.register(socket, identity);
    if (!result.ok) throw new Error("register failed");

    manager.deliver(result.connection, { type: "pong", ts: 1 });
    manager.deliver(result.connection, { type: "pong", ts: 2 });
    manager.deliver(result.connection, { type: "pong", ts: 3 });

    expect(result.connection.droppedMessages).toBe(3);
    // Only the single slow_consumer error was sent, not the pongs.
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((socket.send.mock.calls[0] as [string])[0]) as { code?: string };
    expect(sent.code).toBe("slow_consumer");
  });

  it("closes the socket with 1013 above the hard limit", () => {
    const manager = makeManager();
    const socket = fakeSocket(10_000);
    const result = manager.register(socket, identity);
    if (!result.ok) throw new Error("register failed");

    manager.deliver(result.connection, { type: "pong", ts: 1 });
    expect(socket.close).toHaveBeenCalledWith(1013, expect.any(String));
    expect(socket.send).not.toHaveBeenCalled();
  });
});

describe("connection limits in register()", () => {
  it("enforces the per-end-user limit and frees the slot on unregister", () => {
    const manager = makeManager();
    const results = Array.from({ length: 5 }, () => manager.register(fakeSocket(), identity));
    expect(results.every((result) => result.ok)).toBe(true);

    const sixth = manager.register(fakeSocket(), identity);
    expect(sixth).toEqual({ ok: false, reason: "end_user_limit" });

    const first = results[0];
    if (!first?.ok) throw new Error("unexpected");
    manager.unregister(first.connection);
    expect(manager.register(fakeSocket(), identity).ok).toBe(true);
  });
});

describe("TokenBucket", () => {
  it("allows a burst up to capacity, then refills over time", () => {
    vi.useFakeTimers();
    try {
      const bucket = new TokenBucket(3, 3);
      expect(bucket.tryConsume()).toBe(true);
      expect(bucket.tryConsume()).toBe(true);
      expect(bucket.tryConsume()).toBe(true);
      expect(bucket.tryConsume()).toBe(false);

      vi.advanceTimersByTime(334); // ~1 token refilled
      expect(bucket.tryConsume()).toBe(true);
      expect(bucket.tryConsume()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
