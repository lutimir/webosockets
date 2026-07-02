import { type JsonValue } from "@synckit/core";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { webhookDeliveries, webhookEndpoints, type WebhookDelivery } from "../db/schema.js";

/** How long a claimed delivery is leased before another worker may retry it. */
const CLAIM_LEASE_MS = 30_000;

export async function enqueueDeliveries(
  db: Db,
  endpointIds: string[],
  event: string,
  payload: JsonValue,
): Promise<WebhookDelivery[]> {
  if (endpointIds.length === 0) return [];
  return db
    .insert(webhookDeliveries)
    .values(endpointIds.map((endpointId) => ({ endpointId, event, payload })))
    .returning();
}

export interface ClaimedDelivery {
  delivery: WebhookDelivery;
  endpoint: { url: string; secret: string };
}

/**
 * Atomically claims due deliveries: rows are selected FOR UPDATE SKIP LOCKED
 * (multi-instance safe) and leased by pushing next_attempt_at forward, so a
 * crashed worker's claims become due again after the lease expires.
 */
export async function claimDueDeliveries(db: Db, limit: number): Promise<ClaimedDelivery[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        delivery: webhookDeliveries,
        url: webhookEndpoints.url,
        secret: webhookEndpoints.secret,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
      .for("update", { of: webhookDeliveries, skipLocked: true });

    if (due.length > 0) {
      await tx
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) })
        .where(
          inArray(
            webhookDeliveries.id,
            due.map((row) => row.delivery.id),
          ),
        );
    }
    return due.map((row) => ({
      delivery: row.delivery,
      endpoint: { url: row.url, secret: row.secret },
    }));
  });
}

export async function markDelivered(db: Db, id: string, responseStatus: number): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      responseStatus,
      attempts: sql`${webhookDeliveries.attempts} + 1`,
    })
    .where(eq(webhookDeliveries.id, id));
}

export async function markAttemptFailed(
  db: Db,
  id: string,
  input: { error: string; responseStatus?: number; nextAttemptAt?: Date; final: boolean },
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: input.final ? "failed" : "pending",
      lastError: input.error,
      responseStatus: input.responseStatus ?? null,
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    })
    .where(eq(webhookDeliveries.id, id));
}

export async function getDeliveryById(db: Db, id: string): Promise<WebhookDelivery | undefined> {
  return db.query.webhookDeliveries.findFirst({ where: eq(webhookDeliveries.id, id) });
}

export async function listDeliveriesByEndpoint(
  db: Db,
  endpointId: string,
  limit = 50,
): Promise<WebhookDelivery[]> {
  return db.query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.endpointId, endpointId),
    orderBy: (t, { desc }) => desc(t.id),
    limit: Math.min(limit, 100),
  });
}
