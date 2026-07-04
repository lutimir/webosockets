import { and, eq, gte, lt, sql, sum } from "drizzle-orm";

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

/**
 * Rolls usage_events of the trailing `days` days into usage_daily.
 * Recomputes whole days, so re-runs are idempotent.
 */
export async function rollupUsageDaily(db: Db, days = 2): Promise<void> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
  await db.execute(sql`
    insert into usage_daily (id, project_id, day, kind, total)
    select gen_random_uuid(),
           project_id,
           to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD'),
           kind,
           sum(quantity)::int
    from usage_events
    where occurred_at >= ${since}::timestamptz
    group by project_id, to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD'), kind
    on conflict (project_id, day, kind)
    do update set total = excluded.total, updated_at = now()
  `);
}

/** Daily totals of a usage kind over the trailing `days` days. */
export async function dailyUsage(
  db: Db,
  projectId: string,
  kind: UsageKind,
  days: number,
): Promise<{ day: string; total: number }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
  const day = sql<string>`to_char(date_trunc('day', ${usageEvents.occurredAt}), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, total: sum(usageEvents.quantity) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, projectId),
        eq(usageEvents.kind, kind),
        gte(usageEvents.occurredAt, since),
      ),
    )
    .groupBy(day)
    .orderBy(day);
  return rows.map((row) => ({ day: row.day, total: Number(row.total ?? 0) }));
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
