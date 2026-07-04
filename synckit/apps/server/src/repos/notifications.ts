import { type JsonValue } from "@synckit/core";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { notifications, type Notification } from "../db/schema.js";

export async function createNotification(
  db: Db,
  input: { endUserId: string; type: string; payload?: JsonValue },
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({ endUserId: input.endUserId, type: input.type, payload: input.payload ?? {} })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function listNotificationsForEndUser(
  db: Db,
  endUserId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  return db.query.notifications.findMany({
    where: and(
      eq(notifications.endUserId, endUserId),
      options.unreadOnly ? isNull(notifications.readAt) : undefined,
    ),
    orderBy: desc(notifications.id),
    limit: Math.min(options.limit ?? 50, 100),
  });
}

export async function markNotificationsRead(
  db: Db,
  endUserId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.endUserId, endUserId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
