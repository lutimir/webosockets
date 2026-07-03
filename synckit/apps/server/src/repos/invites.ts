import { randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { organizationInvites, type OrganizationInvite } from "../db/schema.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export async function createInvite(
  db: Db,
  input: { organizationId: string; email: string; role: "admin" | "member" },
): Promise<OrganizationInvite> {
  const [row] = await db
    .insert(organizationInvites)
    .values({
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      token: randomBytes(24).toString("base64url"),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Open (unaccepted, unexpired) invite by its token. */
export async function getOpenInviteByToken(
  db: Db,
  token: string,
): Promise<OrganizationInvite | undefined> {
  return db.query.organizationInvites.findFirst({
    where: and(
      eq(organizationInvites.token, token),
      isNull(organizationInvites.acceptedAt),
      gt(organizationInvites.expiresAt, new Date()),
    ),
  });
}

export async function markInviteAccepted(db: Db, id: string): Promise<void> {
  await db
    .update(organizationInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(organizationInvites.id, id));
}
