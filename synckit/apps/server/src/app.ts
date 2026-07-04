import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { Redis } from "ioredis";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

import { MeteringJob } from "./billing/metering.js";
import { StripeBillingProvider, type BillingProvider } from "./billing/provider.js";
import { billingWebhookRoutes } from "./billing/webhook.js";
import { createDb, type Db } from "./db/client.js";
import { type Env } from "./env.js";
import { httpRequestSeconds, metricsRegistry } from "./metrics.js";
import { healthzRoutes } from "./plugins/healthz.js";
import { realtimeRoutes } from "./plugins/realtime.js";
import { ConnectionManager } from "./realtime/connection-manager.js";
import { RoomHub } from "./realtime/room-hub.js";
import { internalRoutes } from "./routes/internal/index.js";
import { v1Routes } from "./routes/v1/index.js";
import { WebhookDispatcher } from "./webhooks/dispatcher.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    sql: postgres.Sql;
    db: Db;
    redis: Redis;
    realtime: { manager: ConnectionManager; hub: RoomHub };
    webhooks: WebhookDispatcher;
    billing: { provider: BillingProvider | null; metering: MeteringJob };
  }
}

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => uuidv7(),
    logger: {
      level: env.NODE_ENV === "test" ? "warn" : "info",
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
      // Never log credentials: Authorization headers and ?token= are masked.
      redact: { paths: ["req.headers.authorization"], censor: "[redacted]" },
      serializers: {
        req(request: { method: string; url: string; id: string }) {
          return {
            method: request.method,
            url: request.url.replace(/([?&]token=)[^&]+/, "$1[redacted]"),
            id: request.id,
          };
        },
      },
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const sql = postgres(env.DATABASE_URL, { max: 10, connect_timeout: 5 });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
  redis.on("error", (error) => app.log.warn({ err: error }, "redis connection error"));

  const db = createDb(sql);
  app.decorate("env", env);
  app.decorate("sql", sql);
  app.decorate("db", db);
  app.decorate("redis", redis);

  // Realtime engine: dedicated Redis connection for pub/sub subscriptions.
  // No ready check (INFO is not allowed in subscriber mode) and unlimited
  // command retries so subscriptions survive Redis reconnects.
  const subscriber = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
  subscriber.on("error", (error) => app.log.warn({ err: error }, "redis subscriber error"));
  const manager = new ConnectionManager({
    maxPerEndUser: env.WS_MAX_CONNECTIONS_PER_END_USER,
    maxPerProject: env.WS_MAX_CONNECTIONS_PER_PROJECT,
    rateLimitPerSec: env.WS_RATE_LIMIT_PER_SEC,
    backpressureSoftBytes: env.WS_BACKPRESSURE_SOFT_BYTES,
    backpressureHardBytes: env.WS_BACKPRESSURE_HARD_BYTES,
    log: app.log,
  });
  const hub = new RoomHub({
    redis,
    subscriber,
    db,
    manager,
    log: app.log,
    presenceTtlSeconds: env.PRESENCE_TTL_SECONDS,
  });
  manager.startHeartbeat(env.WS_HEARTBEAT_INTERVAL_MS);
  app.decorate("realtime", { manager, hub });

  // Persistent webhook delivery queue.
  const webhooks = new WebhookDispatcher({
    db,
    log: app.log,
    pollIntervalMs: env.WEBHOOK_POLL_INTERVAL_MS,
    backoffBaseMs: env.WEBHOOK_BACKOFF_BASE_MS,
    maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
    allowPrivateTargets: env.WEBHOOKS_ALLOW_PRIVATE || env.NODE_ENV !== "production",
  });
  webhooks.start();
  app.decorate("webhooks", webhooks);

  // Billing: Stripe when configured, otherwise disabled (tests use a fake).
  const billingProvider: BillingProvider | null =
    env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
      ? new StripeBillingProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
      : null;
  const metering = new MeteringJob({
    db,
    redis,
    provider: billingProvider,
    log: app.log,
    intervalMs: env.METERING_INTERVAL_MS,
  });
  metering.start();
  app.decorate("billing", { provider: billingProvider, metering });

  app.addHook("onClose", async () => {
    manager.stop();
    webhooks.stop();
    metering.stop();
    await Promise.allSettled([subscriber.quit(), sql.end({ timeout: 5 }), redis.quit()]);
  });

  // ─── Hardening ─────────────────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: [env.DASHBOARD_ORIGIN] });
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    keyGenerator: (request) => request.headers.authorization ?? request.ip,
    allowList: (request) =>
      request.url === "/healthz" ||
      request.url === "/metrics" ||
      request.url.startsWith("/v1/realtime") ||
      request.url.startsWith("/billing/"),
  });

  // Prometheus exporter. Expose it on the private network only (like
  // /internal) — scrape it, do not publish it.
  app.get("/metrics", { schema: { hide: true } }, async (_request, reply) => {
    return reply.type(metricsRegistry.contentType).send(await metricsRegistry.metrics());
  });

  // Request id on every response; audit log for every mutation.
  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    done(null, payload);
  });
  app.addHook("onResponse", (request, reply, done) => {
    // Route template (not the raw URL) keeps metric cardinality bounded.
    const route = request.routeOptions.url ?? "unmatched";
    if (route !== "/metrics" && route !== "/healthz") {
      httpRequestSeconds.observe(
        { method: request.method, route, status: String(reply.statusCode) },
        reply.elapsedTime / 1_000,
      );
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.url.startsWith("/v1/")) {
      request.log.info(
        {
          audit: true,
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          apiKeyId: request.apiKey?.id,
        },
        "api mutation",
      );
    }
    done();
  });

  /** Postgres-unreachable errors surface as 503 + Retry-After, not 500. */
  function isDatabaseUnavailable(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current; depth++) {
      const candidate = current as { code?: unknown; errno?: unknown; cause?: unknown };
      const raw = candidate.code ?? candidate.errno;
      const code = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
      if (
        [
          "ECONNREFUSED",
          "ECONNRESET",
          "CONNECTION_CLOSED",
          "CONNECTION_ENDED",
          "CONNECT_TIMEOUT",
          "57P01",
        ].includes(code)
      ) {
        return true;
      }
      current = candidate.cause;
    }
    return false;
  }

  // Consistent error envelope for the whole API.
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: error.validation
            .map((issue) => `${issue.instancePath || "body"} ${issue.message ?? "is invalid"}`)
            .join("; "),
        },
      });
    }
    if (isDatabaseUnavailable(error)) {
      return reply
        .status(503)
        .header("retry-after", "5")
        .send({
          error: { code: "service_unavailable", message: "database unavailable, retry shortly" },
        });
    }
    const err = error as FastifyError;
    if (err.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: "rate_limited", message: "rate limit exceeded, retry later" } });
    }
    if (err.statusCode !== undefined && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code ?? "bad_request", message: err.message } });
    }
    request.log.error({ err }, "unhandled error");
    return reply
      .status(500)
      .send({ error: { code: "internal_error", message: "internal server error" } });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "SyncKit API",
        description: "Real-time collaboration infrastructure — REST API",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          apiKey: { type: "http", scheme: "bearer", description: "sk_<env>_… API key" },
        },
      },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });
  await app.register(healthzRoutes);
  await app.register(realtimeRoutes, { prefix: "/v1" });
  await app.register(v1Routes, { prefix: "/v1" });
  await app.register(internalRoutes, { prefix: "/internal" });
  await app.register(billingWebhookRoutes, { prefix: "/billing" });

  return app;
}
