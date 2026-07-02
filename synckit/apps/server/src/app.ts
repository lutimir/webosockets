import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import postgres from "postgres";

import { createDb, type Db } from "./db/client.js";
import { type Env } from "./env.js";
import { healthzRoutes } from "./plugins/healthz.js";
import { realtimeRoutes } from "./plugins/realtime.js";
import { ConnectionManager } from "./realtime/connection-manager.js";
import { RoomHub } from "./realtime/room-hub.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    sql: postgres.Sql;
    db: Db;
    redis: Redis;
    realtime: { manager: ConnectionManager; hub: RoomHub };
  }
}

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "warn" : "info",
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
    },
  });

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
  const subscriber = redis.duplicate();
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

  app.addHook("onClose", async () => {
    manager.stop();
    await Promise.allSettled([subscriber.quit(), sql.end({ timeout: 5 }), redis.quit()]);
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });
  await app.register(healthzRoutes);
  await app.register(realtimeRoutes, { prefix: "/v1" });

  return app;
}
