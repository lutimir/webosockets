import { commentSchema, jsonValueSchema, roomExternalIdSchema } from "@synckit/core";
import { z } from "zod";

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const endUserWireSchema = z.object({
  externalId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export const roomWireSchema = z.object({
  externalId: z.string(),
  metadata: jsonValueSchema,
  createdAt: z.iso.datetime(),
});

export const notificationWireSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  payload: jsonValueSchema,
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const commentWireSchema = commentSchema;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const roomParamsSchema = z.object({
  externalId: roomExternalIdSchema,
});

export { jsonValueSchema, roomExternalIdSchema };
