import { type Db } from "../db/client.js";
import { stripeEvents } from "../db/schema.js";

/**
 * Idempotency gate: records the event id and reports whether it was new.
 * Returns false when the event was already processed.
 */
export async function claimStripeEvent(db: Db, id: string, type: string): Promise<boolean> {
  const rows = await db.insert(stripeEvents).values({ id, type }).onConflictDoNothing().returning();
  return rows.length > 0;
}
