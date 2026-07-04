import { type FastifyReply, type FastifyRequest, type preHandlerAsyncHookHandler } from "fastify";

import { type ApiKey } from "../db/schema.js";
import { touchApiKey, verifyApiKey } from "../repos/index.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}

/**
 * preHandler enforcing `Authorization: Bearer sk_<env>_<secret>`.
 * A key with an empty scope list has full access; otherwise every scope in
 * `requiredScopes` must be present. Successful auth updates last_used_at
 * (throttled in the repo) without blocking the request.
 */
export function requireApiKey(...requiredScopes: string[]): preHandlerAsyncHookHandler {
  return async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return sendApiError(reply, 401, "unauthorized", "missing Authorization: Bearer header");
    }

    const apiKey = await verifyApiKey(request.server.db, header.slice("Bearer ".length).trim());
    if (!apiKey) {
      return sendApiError(reply, 401, "unauthorized", "unknown, malformed or revoked API key");
    }

    if (apiKey.scopes.length > 0) {
      const missing = requiredScopes.filter((scope) => !apiKey.scopes.includes(scope));
      if (missing.length > 0) {
        return sendApiError(
          reply,
          403,
          "insufficient_scope",
          `API key is missing required scopes: ${missing.join(", ")}`,
        );
      }
    }

    request.apiKey = apiKey;
    touchApiKey(request.server.db, apiKey.id).catch((error: unknown) => {
      request.log.warn({ err: error }, "failed to update api key last_used_at");
    });
  };
}

/** The authenticated project id; only valid after `requireApiKey` ran. */
export function projectIdOf(request: FastifyRequest): string {
  if (!request.apiKey) throw new Error("projectIdOf called on unauthenticated request");
  return request.apiKey.projectId;
}
