import { type JsonValue } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { projectIdOf, requireApiKey, sendApiError } from "../../plugins/api-auth.js";
import {
  getEndUserByExternalId,
  listNotificationsForEndUser,
  markNotificationsRead,
} from "../../repos/index.js";

import { errorResponseSchema, notificationWireSchema } from "./schemas.js";

const paramsSchema = z.object({ externalId: z.string().min(1).max(128) });

export function notificationsRoutes(app: FastifyInstance): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/users/:externalId/notifications",
    {
      preHandler: [requireApiKey("notifications:read")],
      schema: {
        operationId: "listNotifications",
        tags: ["notifications"],
        params: paramsSchema,
        querystring: z.object({
          unreadOnly: z.coerce.boolean().default(false),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({ items: z.array(notificationWireSchema) }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const endUser = await getEndUserByExternalId(
        request.server.db,
        projectIdOf(request),
        request.params.externalId,
      );
      if (!endUser) return sendApiError(reply, 404, "not_found", "end user not found");

      const items = await listNotificationsForEndUser(request.server.db, endUser.id, {
        unreadOnly: request.query.unreadOnly,
        limit: request.query.limit,
      });
      return {
        items: items.map((notification) => ({
          id: notification.id,
          type: notification.type,
          payload: notification.payload as JsonValue,
          readAt: notification.readAt?.toISOString() ?? null,
          createdAt: notification.createdAt.toISOString(),
        })),
      };
    },
  );

  routes.post(
    "/users/:externalId/notifications/read",
    {
      preHandler: [requireApiKey("notifications:write")],
      schema: {
        operationId: "markNotificationsRead",
        tags: ["notifications"],
        params: paramsSchema,
        body: z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
        response: {
          200: z.object({ updated: z.number().int() }),
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const endUser = await getEndUserByExternalId(
        request.server.db,
        projectIdOf(request),
        request.params.externalId,
      );
      if (!endUser) return sendApiError(reply, 404, "not_found", "end user not found");

      const updated = await markNotificationsRead(request.server.db, endUser.id, request.body.ids);
      return { updated };
    },
  );
}
