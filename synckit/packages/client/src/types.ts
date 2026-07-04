import { type JsonValue } from "@synckit/core";

/** Connection lifecycle of the client. */
export type Status = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

/** Browser-and-Node compatible subset of the WebSocket interface. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface SyncKitClientOptions {
  /** Realtime endpoint, e.g. "wss://api.example.com/v1/realtime". */
  url: string;
  /**
   * Returns a client JWT minted by your backend via POST /v1/tokens. Called
   * on every (re)connect, so expired tokens refresh automatically.
   */
  tokenProvider: () => string | Promise<string>;
  /** Reconnect backoff floor (default 1000 ms). */
  reconnectMinDelayMs?: number;
  /** Reconnect backoff ceiling (default 30000 ms). */
  reconnectMaxDelayMs?: number;
  /** Broadcast/presence messages buffered while offline (default 100). */
  offlineBufferSize?: number;
  /** Correlated request timeout for comment operations (default 10000 ms). */
  requestTimeoutMs?: number;
  /** Override the WebSocket implementation (tests, exotic runtimes). */
  WebSocketImpl?: WebSocketConstructor;
}

export interface JoinRoomOptions {
  initialPresence?: JsonValue;
}

export interface ClientError {
  code: string;
  message: string;
}
