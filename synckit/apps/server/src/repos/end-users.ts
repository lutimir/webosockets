import { type JsonValue } from "@synckit/core";
import { and, eq, gte } from "drizzle-orm";

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
      // Only overwrite fields the caller actually provided.
      set: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
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

/** End users seen (created or refreshed) since the given date — MAU proxy. */
export async function countActiveEndUsers(db: Db, projectId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: endUsers.id })
    .from(endUsers)
    .where(and(eq(endUsers.projectId, projectId), gte(endUsers.updatedAt, since)));
  return rows.length;
}
