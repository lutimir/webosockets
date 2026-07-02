import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { projectIdOf, requireApiKey, sendApiError } from "../../plugins/api-auth.js";
import {
  getCommentById,
  getRoomByExternalId,
  listCommentsByRoom,
  softDeleteComment,
  toWireComment,
} from "../../repos/index.js";
import { createCommentService, resolveCommentService } from "../../services/comments.js";

import {
  commentWireSchema,
  errorResponseSchema,
  jsonValueSchema,
  paginationQuerySchema,
  roomParamsSchema,
} from "./schemas.js";

const commentParamsSchema = roomParamsSchema.extend({ commentId: z.uuid() });

export function commentsRoutes(app: FastifyInstance): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/rooms/:externalId/comments",
    {
      preHandler: [requireApiKey("comments:read")],
      schema: {
        operationId: "listComments",
        tags: ["comments"],
        params: roomParamsSchema,
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            items: z.array(commentWireSchema),
            nextCursor: z.uuid().optional(),
          }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const room = await getRoomByExternalId(
        request.server.db,
        projectIdOf(request),
        request.params.externalId,
      );
      if (!room) return sendApiError(reply, 404, "not_found", "room not found");

      const page = await listCommentsByRoom(request.server.db, room.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      });
      return {
        items: page.items.map((item) => toWireComment(item, item.endUserExternalId)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
  );

  routes.post(
    "/rooms/:externalId/comments",
    {
      preHandler: [requireApiKey("comments:write")],
      schema: {
        operationId: "createComment",
        description:
          "Creates a comment (or a threaded reply via threadId). Pushes a realtime " +
          "comment_created event to room members, notifies thread participants and " +
          "triggers comment.created webhooks.",
        tags: ["comments"],
        params: roomParamsSchema,
        body: z.object({
          endUserId: z.string().min(1).max(128),
          body: z.string().min(1).max(10_000),
          threadId: z.uuid().optional(),
          anchor: jsonValueSchema.optional(),
        }),
        response: {
          201: commentWireSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await createCommentService(
        {
          db: request.server.db,
          hub: request.server.realtime.hub,
          webhooks: request.server.webhooks,
        },
        {
          projectId: projectIdOf(request),
          roomExternalId: request.params.externalId,
          authorExternalId: request.body.endUserId,
          body: request.body.body,
          threadId: request.body.threadId ?? null,
          anchor: request.body.anchor ?? null,
        },
      );
      if (!result.ok) return sendApiError(reply, 400, result.code, result.message);
      return reply.status(201).send(result.value);
    },
  );

  routes.patch(
    "/rooms/:externalId/comments/:commentId",
    {
      preHandler: [requireApiKey("comments:write")],
      schema: {
        operationId: "updateComment",
        description: "Resolve or unresolve a comment.",
        tags: ["comments"],
        params: commentParamsSchema,
        body: z.object({ resolved: z.boolean() }),
        response: {
          200: commentWireSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { db } = request.server;
      const projectId = projectIdOf(request);

      const room = await getRoomByExternalId(db, projectId, request.params.externalId);
      if (!room) return sendApiError(reply, 404, "not_found", "comment not found");

      const result = await resolveCommentService(
        { db, hub: request.server.realtime.hub, webhooks: request.server.webhooks },
        {
          projectId,
          roomExternalId: request.params.externalId,
          roomId: room.id,
          commentId: request.params.commentId,
          resolved: request.body.resolved,
        },
      );
      if (!result.ok) return sendApiError(reply, 404, result.code, result.message);
      return result.value;
    },
  );

  routes.delete(
    "/rooms/:externalId/comments/:commentId",
    {
      preHandler: [requireApiKey("comments:write")],
      schema: {
        operationId: "deleteComment",
        description: "Soft-deletes a comment; it disappears from listings.",
        tags: ["comments"],
        params: commentParamsSchema,
        response: {
          // Fastify sends no body for 204 regardless of schema.
          204: z.null(),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { db } = request.server;
      const room = await getRoomByExternalId(db, projectIdOf(request), request.params.externalId);
      const existing = room && (await getCommentById(db, request.params.commentId));
      if (!room || !existing || existing.roomId !== room.id) {
        return sendApiError(reply, 404, "not_found", "comment not found");
      }

      await softDeleteComment(db, existing.id);
      return reply.status(204).send(null);
    },
  );
}
