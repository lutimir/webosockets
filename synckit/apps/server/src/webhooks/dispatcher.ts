import { type JsonValue } from "@synckit/core";
import { type FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";

import { type Db } from "../db/client.js";
import {
  claimDueDeliveries,
  enqueueDeliveries,
  listActiveEndpointsForEvent,
  markAttemptFailed,
  markDelivered,
  type ClaimedDelivery,
} from "../repos/index.js";

import { signWebhookPayload } from "./signature.js";

export interface WebhookDispatcherOptions {
  db: Db;
  log: FastifyBaseLogger;
  pollIntervalMs: number;
  backoffBaseMs: number;
  maxAttempts: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Persistent webhook queue: events are enqueued as `webhook_deliveries` rows,
 * a poller claims due rows (SKIP LOCKED — safe with multiple instances) and
 * POSTs them with an HMAC signature. Failures retry with exponential backoff
 * up to `maxAttempts`, then the delivery is marked failed.
 */
export class WebhookDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WebhookDispatcherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Fans an event out to every active endpoint subscribed to it. */
  async enqueue(projectId: string, event: string, payload: JsonValue): Promise<void> {
    const endpoints = await listActiveEndpointsForEvent(this.options.db, projectId, event);
    if (endpoints.length === 0) return;
    await enqueueDeliveries(
      this.options.db,
      endpoints.map((endpoint) => endpoint.id),
      event,
      payload,
    );
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.ticking) return; // never overlap ticks
      this.ticking = true;
      void this.tick()
        .catch((error: unknown) => {
          this.options.log.error({ err: error }, "webhook dispatcher tick failed");
        })
        .finally(() => {
          this.ticking = false;
        });
    }, this.options.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One poll cycle — exposed for deterministic tests. */
  async tick(): Promise<void> {
    const claimed = await claimDueDeliveries(this.options.db, 10);
    for (const item of claimed) {
      await this.attempt(item);
    }
  }

  private async attempt({ delivery, endpoint }: ClaimedDelivery): Promise<void> {
    const body = JSON.stringify({
      id: uuidv7(),
      deliveryId: delivery.id,
      event: delivery.event,
      createdAt: new Date().toISOString(),
      data: delivery.payload as JsonValue,
    });
    const timestamp = Math.floor(Date.now() / 1000);

    let responseStatus: number | undefined;
    let errorMessage: string;
    try {
      const response = await this.fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "SyncKit-Webhooks/1.0",
          "x-synckit-signature": signWebhookPayload(endpoint.secret, body, timestamp),
        },
        body,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 5_000),
      });
      if (response.ok) {
        await markDelivered(this.options.db, delivery.id, response.status);
        return;
      }
      responseStatus = response.status;
      errorMessage = `endpoint responded with ${response.status}`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const attempts = delivery.attempts + 1;
    const final = attempts >= this.options.maxAttempts;
    await markAttemptFailed(this.options.db, delivery.id, {
      error: errorMessage,
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      final,
      // Exponential backoff: base * 2^(attempt-1).
      nextAttemptAt: new Date(Date.now() + this.options.backoffBaseMs * 2 ** (attempts - 1)),
    });
    this.options.log.warn(
      { deliveryId: delivery.id, attempts, final, err: errorMessage },
      "webhook delivery attempt failed",
    );
  }
}
