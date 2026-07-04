import { presenceEntrySchema, type JsonValue } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { type Room } from "../../db/schema.js";
import { projectIdOf, requireApiKey, sendApiError } from "../../plugins/api-auth.js";
import { getRoomByExternalId, listRoomsByProjectPaged, upsertRoom } from "../../repos/index.js";

import {
  errorResponseSchema,
  jsonValueSchema,
  paginationQuerySchema,
  roomExternalIdSchema,
  roomParamsSchema,
  roomWireSchema,
} from "./schemas.js";

function toWireRoom(room: Room) {
  return {
    externalId: room.externalId,
    metadata: room.metadata as JsonValue,
    createdAt: room.createdAt.toISOString(),
  };
}

export function roomsRoutes(app: FastifyInstance): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/rooms",
    {
      preHandler: [requireApiKey("rooms:read")],
      schema: {
        operationId: "listRooms",
        tags: ["rooms"],
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            items: z.array(roomWireSchema),
            nextCursor: z.uuid().optional(),
          }),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const page = await listRoomsByProjectPaged(request.server.db, projectIdOf(request), {
        cursor: request.query.cursor,
        limit: request.query.limit,
      });
      return {
        items: page.items.map(toWireRoom),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
  );

  routes.post(
    "/rooms",
    {
      preHandler: [requireApiKey("rooms:write")],
      schema: {
        operationId: "createRoom",
        description: "Creates a room (idempotent — an existing room is returned unchanged).",
        tags: ["rooms"],
        body: z.object({
          externalId: roomExternalIdSchema,
          metadata: jsonValueSchema.optional(),
        }),
        response: { 201: roomWireSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const room = await upsertRoom(request.server.db, {
        projectId: projectIdOf(request),
        externalId: request.body.externalId,
        ...(request.body.metadata !== undefined ? { metadata: request.body.metadata } : {}),
      });
      return reply.status(201).send(toWireRoom(room));
    },
  );

  routes.get(
    "/rooms/:externalId/presence",
    {
      preHandler: [requireApiKey("rooms:read")],
      schema: {
        operationId: "getRoomPresence",
        description: "Live presence of a room, read from Redis.",
        tags: ["rooms"],
        params: roomParamsSchema,
        response: {
          200: z.object({ presence: z.array(presenceEntrySchema) }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const projectId = projectIdOf(request);
      const room = await getRoomByExternalId(
        request.server.db,
        projectId,
        request.params.externalId,
      );
      if (!room) return sendApiError(reply, 404, "not_found", "room not found");

      const presence = await request.server.realtime.hub.getPresence(
        projectId,
        request.params.externalId,
      );
      return { presence };
    },
  );
}
