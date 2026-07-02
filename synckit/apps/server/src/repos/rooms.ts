import { type JsonValue } from "@synckit/core";
import { and, eq } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { rooms, type Room } from "../db/schema.js";

export async function upsertRoom(
  db: Db,
  input: { projectId: string; externalId: string; metadata?: JsonValue },
): Promise<Room> {
  const [row] = await db
    .insert(rooms)
    .values({
      projectId: input.projectId,
      externalId: input.externalId,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [rooms.projectId, rooms.externalId],
      set: { updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("upsert returned no row");
  return row;
}

export async function getRoomByExternalId(
  db: Db,
  projectId: string,
  externalId: string,
): Promise<Room | undefined> {
  return db.query.rooms.findFirst({
    where: and(eq(rooms.projectId, projectId), eq(rooms.externalId, externalId)),
  });
}

export async function listRoomsByProject(db: Db, projectId: string): Promise<Room[]> {
  return db.query.rooms.findMany({ where: eq(rooms.projectId, projectId) });
}
