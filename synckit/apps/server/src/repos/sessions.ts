import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { sessions, users, type Session, type User } from "../db/schema.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString("base64url");
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();
  if (!session) throw new Error("insert returned no row");
  return { token, session };
}

/** Resolves a live (unexpired) session to its user. */
export async function getSessionUser(
  db: Db,
  token: string,
): Promise<{ session: Session; user: User } | undefined> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
