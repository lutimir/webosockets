import { z } from "zod";

import { boundedJson, jsonValueSchema } from "./json.js";

export const PROTOCOL_VERSION = 1;

/** Maximum serialized size of a presence payload. */
export const PRESENCE_MAX_BYTES = 1024;
/** Maximum serialized size of a broadcast payload. */
export const BROADCAST_MAX_BYTES = 4096;

export const roomExternalIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_:.-]+$/, "room ids may contain letters, digits, '_', ':', '.' and '-'");

export const presenceDataSchema = boundedJson(PRESENCE_MAX_BYTES);

export const presenceEntrySchema = z.object({
  endUserId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  data: jsonValueSchema,
});
export type PresenceEntry = z.infer<typeof presenceEntrySchema>;

// ─── Client → Server ─────────────────────────────────────────────────────────

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_room"),
    roomExternalId: roomExternalIdSchema,
    initialPresence: presenceDataSchema.optional(),
  }),
  z.object({
    type: z.literal("leave_room"),
    roomExternalId: roomExternalIdSchema,
  }),
  z.object({
    type: z.literal("presence_update"),
    roomExternalId: roomExternalIdSchema,
    data: presenceDataSchema,
  }),
  z.object({
    type: z.literal("broadcast"),
    roomExternalId: roomExternalIdSchema,
    event: z.string().min(1).max(64),
    payload: boundedJson(BROADCAST_MAX_BYTES),
  }),
  z.object({
    type: z.literal("comment_create"),
    roomExternalId: roomExternalIdSchema,
    body: z.string().min(1).max(10_000),
    threadId: z.uuid().optional(),
    anchor: jsonValueSchema.optional(),
  }),
  z.object({
    type: z.literal("ping"),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ─── Server → Client ─────────────────────────────────────────────────────────

export const serverErrorCodeSchema = z.enum([
  "invalid_message",
  "not_in_room",
  "room_limit_reached",
  "rate_limited",
  "slow_consumer",
  "internal_error",
]);
export type ServerErrorCode = z.infer<typeof serverErrorCodeSchema>;

export const commentSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid().nullable(),
  endUserId: z.string(),
  body: z.string(),
  anchor: jsonValueSchema.nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Comment = z.infer<typeof commentSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room_joined"),
    roomExternalId: roomExternalIdSchema,
    seq: z.number().int().nonnegative(),
    presence: z.array(presenceEntrySchema),
  }),
  z.object({
    type: z.literal("presence_diff"),
    roomExternalId: roomExternalIdSchema,
    seq: z.number().int().nonnegative(),
    joined: z.array(presenceEntrySchema),
    left: z.array(z.string()),
    updated: z.array(presenceEntrySchema),
  }),
  z.object({
    type: z.literal("broadcast_received"),
    roomExternalId: roomExternalIdSchema,
    seq: z.number().int().nonnegative(),
    event: z.string(),
    payload: jsonValueSchema,
    from: z.string(),
  }),
  z.object({
    type: z.literal("comment_created"),
    roomExternalId: roomExternalIdSchema,
    seq: z.number().int().nonnegative(),
    comment: commentSchema,
  }),
  z.object({
    type: z.literal("error"),
    code: serverErrorCodeSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("pong"),
    ts: z.number().int().nonnegative(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "message is not valid JSON" };
    }
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }
  return { ok: true, message: result.data };
}

// ─── WebSocket close codes ───────────────────────────────────────────────────

export const CLOSE_CODES = {
  /** Authentication failed (missing/invalid/expired token). */
  UNAUTHORIZED: 4401,
  /** Plan limit reached (too many concurrent connections). */
  LIMIT_EXCEEDED: 4403,
  /** Client kept sending after repeated rate-limit warnings. */
  RATE_LIMITED: 4429,
} as const;
