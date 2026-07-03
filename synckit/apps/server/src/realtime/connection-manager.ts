import { type ServerMessage } from "@synckit/core";
import { type FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { type WebSocket } from "ws";

import { type ClientIdentity } from "../lib/tokens.js";

/** Sliding token bucket: `capacity` burst, refilled at `refillPerSec`. */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
  }

  tryConsume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.lastRefill) / 1_000) * this.refillPerSec,
    );
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export interface ManagedConnection {
  id: string;
  socket: WebSocket;
  identity: ClientIdentity;
  /** roomExternalIds this connection has joined. */
  joinedRooms: Set<string>;
  connectedAt: number;
  missedPongs: number;
  bucket: TokenBucket;
  rateViolations: number;
  slowConsumerNotified: boolean;
  droppedMessages: number;
}

export interface ConnectionManagerOptions {
  maxPerEndUser: number;
  maxPerProject: number;
  rateLimitPerSec: number;
  backpressureSoftBytes: number;
  backpressureHardBytes: number;
  log: FastifyBaseLogger;
}

export type RegisterResult =
  | { ok: true; connection: ManagedConnection }
  | { ok: false; reason: "end_user_limit" | "project_limit" };

/**
 * Tracks live WebSocket connections on this instance: registration with
 * per-user/per-project limits, heartbeats, and backpressure-aware delivery.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly perEndUser = new Map<string, number>();
  private readonly perProject = new Map<string, number>();
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: ConnectionManagerOptions) {}

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Live connections of one project on this instance. */
  connectionCountForProject(projectId: string): number {
    return this.perProject.get(projectId) ?? 0;
  }

  register(socket: WebSocket, identity: ClientIdentity): RegisterResult {
    const userKey = `${identity.projectId}:${identity.endUserId}`;
    if ((this.perEndUser.get(userKey) ?? 0) >= this.options.maxPerEndUser) {
      return { ok: false, reason: "end_user_limit" };
    }
    if ((this.perProject.get(identity.projectId) ?? 0) >= this.options.maxPerProject) {
      return { ok: false, reason: "project_limit" };
    }

    const connection: ManagedConnection = {
      id: uuidv7(),
      socket,
      identity,
      joinedRooms: new Set(),
      connectedAt: Date.now(),
      missedPongs: 0,
      bucket: new TokenBucket(this.options.rateLimitPerSec, this.options.rateLimitPerSec),
      rateViolations: 0,
      slowConsumerNotified: false,
      droppedMessages: 0,
    };

    this.connections.set(connection.id, connection);
    this.perEndUser.set(userKey, (this.perEndUser.get(userKey) ?? 0) + 1);
    this.perProject.set(identity.projectId, (this.perProject.get(identity.projectId) ?? 0) + 1);
    socket.on("pong", () => {
      connection.missedPongs = 0;
    });
    return { ok: true, connection };
  }

  unregister(connection: ManagedConnection): void {
    if (!this.connections.delete(connection.id)) return;
    const userKey = `${connection.identity.projectId}:${connection.identity.endUserId}`;
    const decrement = (map: Map<string, number>, key: string) => {
      const next = (map.get(key) ?? 1) - 1;
      if (next <= 0) map.delete(key);
      else map.set(key, next);
    };
    decrement(this.perEndUser, userKey);
    decrement(this.perProject, connection.identity.projectId);
  }

  /**
   * Sends a message respecting backpressure: past the soft limit messages are
   * dropped (client is told once via `slow_consumer`); past the hard limit the
   * connection is closed with 1013 (Try Again Later).
   */
  deliver(connection: ManagedConnection, message: ServerMessage): void {
    const { socket } = connection;
    if (socket.readyState !== socket.OPEN) return;

    const buffered = socket.bufferedAmount;
    if (buffered >= this.options.backpressureHardBytes) {
      this.options.log.warn(
        { connectionId: connection.id, buffered },
        "closing slow consumer (hard backpressure limit)",
      );
      socket.close(1013, "backpressure limit exceeded");
      return;
    }
    if (buffered >= this.options.backpressureSoftBytes) {
      connection.droppedMessages += 1;
      if (!connection.slowConsumerNotified) {
        connection.slowConsumerNotified = true;
        socket.send(
          JSON.stringify({
            type: "error",
            code: "slow_consumer",
            message: "messages are being dropped because your connection cannot keep up",
          } satisfies ServerMessage),
        );
      }
      return;
    }

    connection.slowConsumerNotified = false;
    socket.send(JSON.stringify(message));
  }

  /** Server pings every interval; two missed pongs and the socket is dead. */
  startHeartbeat(intervalMs: number): void {
    this.heartbeatTimer = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (connection.missedPongs >= 2) {
          this.options.log.info(
            { connectionId: connection.id },
            "terminating unresponsive connection",
          );
          connection.socket.terminate();
          continue;
        }
        connection.missedPongs += 1;
        connection.socket.ping();
      }
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const connection of this.connections.values()) {
      connection.socket.close(1001, "server shutting down");
    }
  }

  /**
   * Hard-terminates every socket without a close frame — as an instance crash
   * or network partition would. Used by chaos/reconnect tests.
   */
  terminateAllSockets(): void {
    for (const connection of this.connections.values()) {
      connection.socket.terminate();
    }
  }
}
