import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { projectIdOf, requireApiKey, sendApiError } from "../../plugins/api-auth.js";
import {
  createComment,
  createNotification,
  getCommentById,
  getEndUserByExternalId,
  getEndUserById,
  getRoomByExternalId,
  listCommentsByRoom,
  listThreadParticipantEndUserIds,
  recordUsage,
  setCommentResolved,
  softDeleteComment,
  toWireComment,
  upsertEndUser,
  upsertRoom,
} from "../../repos/index.js";

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
      const { db } = request.server;
      const projectId = projectIdOf(request);

      // Rooms are created lazily — a comment may be the room's first event.
      const room = await upsertRoom(db, { projectId, externalId: request.params.externalId });

      const author =
        (await getEndUserByExternalId(db, projectId, request.body.endUserId)) ??
        (await upsertEndUser(db, { projectId, externalId: request.body.endUserId }));

      if (request.body.threadId) {
        const root = await getCommentById(db, request.body.threadId);
        if (!root || root.roomId !== room.id) {
          return sendApiError(
            reply,
            400,
            "invalid_thread",
            "threadId does not belong to this room",
          );
        }
        if (root.threadId !== null) {
          return sendApiError(reply, 400, "invalid_thread", "threadId must point to a thread root");
        }
      }

      const comment = await createComment(db, {
        roomId: room.id,
        endUserId: author.id,
        body: request.body.body,
        threadId: request.body.threadId ?? null,
        anchor: request.body.anchor ?? null,
      });
      const wire = toWireComment(comment, author.externalId);

      // Realtime push to everyone currently in the room.
      await request.server.realtime.hub.publishCommentCreated(
        projectId,
        request.params.externalId,
        wire,
      );

      // Notify other participants of the thread.
      if (comment.threadId) {
        const participants = await listThreadParticipantEndUserIds(db, comment.threadId);
        await Promise.all(
          participants
            .filter((endUserId) => endUserId !== author.id)
            .map((endUserId) =>
              createNotification(db, {
                endUserId,
                type: "comment.replied",
                payload: {
                  roomExternalId: request.params.externalId,
                  threadId: comment.threadId,
                  commentId: comment.id,
                  from: author.externalId,
                },
              }),
            ),
        );
      }

      await request.server.webhooks.enqueue(projectId, "comment.created", wire);
      await recordUsage(db, { projectId, kind: "message", quantity: 1 });

      return reply.status(201).send(wire);
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
      const existing = room && (await getCommentById(db, request.params.commentId));
      if (!room || !existing || existing.roomId !== room.id) {
        return sendApiError(reply, 404, "not_found", "comment not found");
      }

      const updated = await setCommentResolved(db, existing.id, request.body.resolved);
      if (!updated) return sendApiError(reply, 404, "not_found", "comment not found");

      const author = await getEndUserById(db, updated.endUserId);
      const wire = toWireComment(updated, author?.externalId ?? "");
      if (request.body.resolved) {
        await request.server.webhooks.enqueue(projectId, "comment.resolved", wire);
      }
      return wire;
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
