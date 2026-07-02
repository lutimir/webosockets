import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { signClientToken } from "../../lib/tokens.js";
import { requireApiKey, projectIdOf } from "../../plugins/api-auth.js";
import { upsertEndUser } from "../../repos/index.js";

import { endUserWireSchema, errorResponseSchema, jsonValueSchema } from "./schemas.js";

const bodySchema = z.object({
  externalUserId: z.string().min(1).max(128),
  displayName: z.string().max(200).optional(),
  avatarUrl: z.url().max(1_000).optional(),
  metadata: jsonValueSchema.optional(),
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
});

const responseSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  endUser: endUserWireSchema,
});

export function tokensRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/tokens",
    {
      preHandler: [requireApiKey("tokens:write")],
      schema: {
        operationId: "createClientToken",
        description:
          "Exchange your server API key for a short-lived client JWT for one of " +
          "your users. Refresh by calling this endpoint again — the SDK does this " +
          "automatically via its tokenProvider when a token expires (WS close 4401).",
        tags: ["tokens"],
        body: bodySchema,
        response: { 200: responseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
      },
    },
    async (request) => {
      const projectId = projectIdOf(request);
      const input = request.body;

      const endUser = await upsertEndUser(request.server.db, {
        projectId,
        externalId: input.externalUserId,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });

      const ttlSeconds = input.ttlSeconds ?? request.server.env.CLIENT_TOKEN_TTL_SECONDS;
      const token = await signClientToken(
        request.server.env.JWT_SECRET,
        {
          projectId,
          endUserId: endUser.externalId,
          displayName: endUser.displayName,
          avatarUrl: endUser.avatarUrl,
        },
        ttlSeconds,
      );

      return {
        token,
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
        endUser: {
          externalId: endUser.externalId,
          displayName: endUser.displayName,
          avatarUrl: endUser.avatarUrl,
        },
      };
    },
  );
}
