import { parseServerMessage, type ServerMessage } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await buildApp(loadEnv({ NODE_ENV: "test" }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no listen address");
  baseUrl = `127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${baseUrl}/v1/realtime`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), 5_000);
    socket.once("message", (raw: Buffer) => {
      clearTimeout(timer);
      const parsed = parseServerMessage(raw.toString("utf8"));
      if (parsed.ok) resolve(parsed.message);
      else reject(new Error(`server sent invalid message: ${parsed.error}`));
    });
  });
}

describe("GET /healthz", () => {
  it("reports db and redis as ok when both are reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
});

describe("WS /v1/realtime", () => {
  it("answers ping with pong", async () => {
    const socket = await connect();
    try {
      socket.send(JSON.stringify({ type: "ping" }));
      const message = await nextMessage(socket);
      expect(message.type).toBe("pong");
      if (message.type === "pong") {
        expect(message.ts).toBeGreaterThan(0);
      }
    } finally {
      socket.close();
    }
  });

  it("rejects invalid messages with an error and keeps the connection open", async () => {
    const socket = await connect();
    try {
      socket.send("{definitely not json");
      const error = await nextMessage(socket);
      expect(error.type).toBe("error");
      if (error.type === "error") {
        expect(error.code).toBe("invalid_message");
      }

      // Connection must survive a bad message.
      socket.send(JSON.stringify({ type: "ping" }));
      const pong = await nextMessage(socket);
      expect(pong.type).toBe("pong");
    } finally {
      socket.close();
    }
  });

  it("rejects binary frames", async () => {
    const socket = await connect();
    try {
      socket.send(Buffer.from([0x01, 0x02]));
      const error = await nextMessage(socket);
      expect(error.type).toBe("error");
    } finally {
      socket.close();
    }
  });

  it("answers valid-but-unimplemented messages with an explanatory error", async () => {
    const socket = await connect();
    try {
      socket.send(JSON.stringify({ type: "join_room", roomExternalId: "doc-1" }));
      const error = await nextMessage(socket);
      expect(error.type).toBe("error");
      if (error.type === "error") {
        expect(error.message).toContain("join_room");
      }
    } finally {
      socket.close();
    }
  });
});

describe("graceful shutdown", () => {
  it("closes open websocket connections on app.close()", async () => {
    const localApp = await buildApp(loadEnv({ NODE_ENV: "test" }));
    await localApp.listen({ port: 0, host: "127.0.0.1" });
    const address = localApp.server.address();
    if (address === null || typeof address === "string") throw new Error("no listen address");

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/v1/realtime`);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await localApp.close();
    await closed;
    expect(socket.readyState).toBe(socket.CLOSED);
  });
});
