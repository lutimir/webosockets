import {
  parseServerMessage,
  type ClientMessage,
  type Notification,
  type ServerMessage,
} from "@synckit/core";

import { computeBackoffDelay } from "./backoff.js";
import { Emitter, type Unsubscribe } from "./events.js";
import { Room } from "./room.js";
import {
  type ClientError,
  type JoinRoomOptions,
  type Status,
  type SyncKitClientOptions,
  type WebSocketConstructor,
} from "./types.js";

const WS_OPEN = 1;

interface PendingRequest {
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Extracts the end user id (sub) from a JWT without verifying it. */
function decodeTokenSubject(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: unknown;
    };
    return typeof json.sub === "string" ? json.sub : undefined;
  } catch {
    return undefined;
  }
}

export function createClient(options: SyncKitClientOptions): SyncKitClient {
  return new SyncKitClient(options);
}

export class SyncKitClient {
  private readonly options: Required<
    Omit<SyncKitClientOptions, "WebSocketImpl" | "tokenProvider">
  > &
    Pick<SyncKitClientOptions, "WebSocketImpl" | "tokenProvider">;

  private currentStatus: Status = "idle";
  private readonly emitter = new Emitter<{
    status: Status;
    error: ClientError;
    notification: Notification;
  }>();
  private readonly rooms = new Map<string, Room>();
  private socket: { ws: InstanceType<WebSocketConstructor>; generation: number } | undefined;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private userClosed = false;
  private readonly outbox: ClientMessage[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private myEndUserId: string | undefined;
  private requestCounter = 0;

  constructor(options: SyncKitClientOptions) {
    this.options = {
      reconnectMinDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      offlineBufferSize: 100,
      requestTimeoutMs: 10_000,
      ...options,
    };
  }

  get status(): Status {
    return this.currentStatus;
  }

  /** Everyone-else user id of this client, known once a token was fetched. */
  get endUserId(): string | undefined {
    return this.myEndUserId;
  }

  on(event: "status", handler: (status: Status) => void): Unsubscribe;
  on(event: "error", handler: (error: ClientError) => void): Unsubscribe;
  on(
    event: "status" | "error",
    handler: ((status: Status) => void) | ((error: ClientError) => void),
  ): Unsubscribe {
    return this.emitter.on(event as "status", handler as (status: Status) => void);
  }

  readonly notifications = {
    subscribe: (handler: (notification: Notification) => void): Unsubscribe =>
      this.emitter.on("notification", handler),
  };

  /** Starts (or restarts) the connection. Safe to call repeatedly. */
  connect(): void {
    if (this.currentStatus !== "idle" && this.currentStatus !== "closed") return;
    this.userClosed = false;
    this.reconnectAttempt = 0;
    this.transition("connecting");
    void this.dial();
  }

  /**
   * Returns the room handle (creating it if needed) and joins it as soon as
   * the connection is up. Auto-connects an idle client.
   */
  joinRoom(roomExternalId: string, options: JoinRoomOptions = {}): Room {
    const existing = this.rooms.get(roomExternalId);
    if (existing) return existing;

    const room = new Room(roomExternalId, options.initialPresence, {
      send: (message, bufferable) => this.sendMessage(message, bufferable),
      request: (message) => this.request(message),
      getMyId: () => this.myEndUserId,
      onLeft: (externalId) => this.rooms.delete(externalId),
      generateRequestId: () => `req-${Date.now()}-${++this.requestCounter}`,
    });
    this.rooms.set(roomExternalId, room);

    if (this.currentStatus === "connected") room.sendJoin();
    else this.connect();
    return room;
  }

  /** Closes the connection permanently — no reconnects until connect(). */
  disconnect(): void {
    this.userClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.generation += 1; // invalidate in-flight dials and socket events
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new Error("client disconnected"));
    }
    this.pending.clear();
    this.socket?.ws.close(1_000, "client disconnect");
    this.socket = undefined;
    this.transition("closed");
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private transition(status: Status): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emitter.emit("status", status);
  }

  private async dial(): Promise<void> {
    const generation = ++this.generation;

    let token: string;
    try {
      token = await this.options.tokenProvider();
    } catch (error) {
      this.emitter.emit("error", {
        code: "token_provider_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation || this.userClosed) return;

    this.myEndUserId = decodeTokenSubject(token) ?? this.myEndUserId;

    const WebSocketImpl: WebSocketConstructor | undefined =
      this.options.WebSocketImpl ?? globalThis.WebSocket;
    if (!WebSocketImpl) {
      throw new Error("no WebSocket implementation available; pass options.WebSocketImpl");
    }

    let ws: InstanceType<WebSocketConstructor>;
    try {
      ws = new WebSocketImpl(`${this.options.url}?token=${encodeURIComponent(token)}`);
    } catch (error) {
      this.emitter.emit("error", {
        code: "websocket_construct_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = { ws, generation };

    ws.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.reconnectAttempt = 0;
      this.transition("connected");
      // Re-join every room with the latest presence, then flush the buffer.
      for (const room of this.rooms.values()) room.sendJoin();
      const buffered = this.outbox.splice(0, this.outbox.length);
      for (const message of buffered) ws.send(JSON.stringify(message));
    });

    ws.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      this.handleServerData(event.data);
    });

    ws.addEventListener("close", (event) => {
      if (generation !== this.generation) return;
      this.socket = undefined;
      if (this.userClosed) {
        this.transition("closed");
        return;
      }
      // 4401 = expired/invalid token; the next dial fetches a fresh one.
      this.scheduleReconnect(event.code);
    });

    ws.addEventListener("error", () => {
      // The close event follows and drives the reconnect.
    });
  }

  private scheduleReconnect(closeCode?: number): void {
    if (this.userClosed) return;
    this.transition("reconnecting");
    if (closeCode !== undefined && closeCode !== 1_000 && closeCode !== 1_001) {
      this.emitter.emit("error", {
        code: `connection_closed_${closeCode}`,
        message: "connection lost, reconnecting",
      });
    }
    const delay = computeBackoffDelay(this.reconnectAttempt++, {
      minDelayMs: this.options.reconnectMinDelayMs,
      maxDelayMs: this.options.reconnectMaxDelayMs,
    });
    this.reconnectTimer = setTimeout(() => void this.dial(), delay);
  }

  private handleServerData(data: unknown): void {
    const parsed = parseServerMessage(typeof data === "string" ? data : String(data));
    if (!parsed.ok) {
      this.emitter.emit("error", { code: "invalid_server_message", message: parsed.error });
      return;
    }
    const message = parsed.message;

    // Correlated request/response settlement.
    if ("requestId" in message && message.requestId !== undefined) {
      const request = this.pending.get(message.requestId);
      if (request) {
        this.pending.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.type === "error") {
          request.reject(new Error(`${message.code}: ${message.message}`));
        } else {
          request.resolve(message);
        }
      }
    }

    switch (message.type) {
      case "notification":
        this.emitter.emit("notification", message.notification);
        return;
      case "pong":
        return;
      case "error":
        if (!("requestId" in message) || message.requestId === undefined) {
          this.emitter.emit("error", { code: message.code, message: message.message });
        }
        return;
      default:
        this.rooms.get(message.roomExternalId)?.handleServerMessage(message);
    }
  }

  private sendMessage(message: ClientMessage, bufferable: boolean): void {
    const socket = this.socket;
    if (this.currentStatus === "connected" && socket && socket.ws.readyState === WS_OPEN) {
      socket.ws.send(JSON.stringify(message));
      return;
    }
    if (!bufferable) return; // joins are replayed by the reconnect logic
    this.outbox.push(message);
    while (this.outbox.length > this.options.offlineBufferSize) {
      this.outbox.shift(); // drop the oldest
    }
  }

  private request(message: ClientMessage & { requestId: string }): Promise<ServerMessage> {
    const socket = this.socket;
    if (this.currentStatus !== "connected" || !socket || socket.ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error("request timed out"));
      }, this.options.requestTimeoutMs);
      this.pending.set(message.requestId, { resolve, reject, timer });
      socket.ws.send(JSON.stringify(message));
    });
  }
}
