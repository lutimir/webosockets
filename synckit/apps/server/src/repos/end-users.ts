import { type JsonValue } from "@synckit/core";
import { and, eq } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { endUsers, type EndUser } from "../db/schema.js";

export interface UpsertEndUserInput {
  projectId: string;
  externalId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  metadata?: JsonValue;
}

/** Creates the end user on first sight, refreshes profile fields afterwards. */
export async function upsertEndUser(db: Db, input: UpsertEndUserInput): Promise<EndUser> {
  const [row] = await db
    .insert(endUsers)
    .values({
      projectId: input.projectId,
      externalId: input.externalId,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [endUsers.projectId, endUsers.externalId],
      set: {
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("upsert returned no row");
  return row;
}

export async function getEndUserByExternalId(
  db: Db,
  projectId: string,
  externalId: string,
): Promise<EndUser | undefined> {
  return db.query.endUsers.findFirst({
    where: and(eq(endUsers.projectId, projectId), eq(endUsers.externalId, externalId)),
  });
}

export async function getEndUserById(db: Db, id: string): Promise<EndUser | undefined> {
  return db.query.endUsers.findFirst({ where: eq(endUsers.id, id) });
}

export async function listEndUsersByProject(db: Db, projectId: string): Promise<EndUser[]> {
  return db.query.endUsers.findMany({ where: eq(endUsers.projectId, projectId) });
}
