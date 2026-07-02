export { createClient, SyncKitClient } from "./client.js";
export { Room, type CommentPage, type RoomDeps } from "./room.js";
export { computeBackoffDelay, type BackoffOptions } from "./backoff.js";
export { Emitter, type Unsubscribe } from "./events.js";
export type {
  ClientError,
  JoinRoomOptions,
  Status,
  SyncKitClientOptions,
  WebSocketConstructor,
  WebSocketLike,
} from "./types.js";
export type { Comment, JsonValue, Notification, PresenceEntry, ServerMessage } from "@synckit/core";
