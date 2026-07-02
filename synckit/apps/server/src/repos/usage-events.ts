import { and, eq, gte, lt, sum } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { usageEvents, type UsageEvent } from "../db/schema.js";

export type UsageKind = UsageEvent["kind"];

export async function recordUsage(
  db: Db,
  input: { projectId: string; kind: UsageKind; quantity: number; occurredAt?: Date },
): Promise<UsageEvent> {
  const [row] = await db
    .insert(usageEvents)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      quantity: input.quantity,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function sumUsage(
  db: Db,
  input: { projectId: string; kind: UsageKind; from: Date; to: Date },
): Promise<number> {
  const [row] = await db
    .select({ total: sum(usageEvents.quantity) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, input.projectId),
        eq(usageEvents.kind, input.kind),
        gte(usageEvents.occurredAt, input.from),
        lt(usageEvents.occurredAt, input.to),
      ),
    );
  return Number(row?.total ?? 0);
}
