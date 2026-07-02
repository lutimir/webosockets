import { eq } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { organizationMembers, organizations, users, type Organization } from "../db/schema.js";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  plan?: Organization["plan"];
}

export async function createOrganization(
  db: Db,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const [row] = await db.insert(organizations).values(input).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function getOrganizationById(db: Db, id: string): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({ where: eq(organizations.id, id) });
}

export async function getOrganizationBySlug(
  db: Db,
  slug: string,
): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
}

export async function updateOrganization(
  db: Db,
  id: string,
  patch: Partial<Pick<Organization, "name" | "plan" | "stripeCustomerId">>,
): Promise<Organization | undefined> {
  const [row] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, id))
    .returning();
  return row;
}

export interface AddMemberInput {
  organizationId: string;
  userId: string;
  role?: "owner" | "admin" | "member";
}

export async function addMember(db: Db, input: AddMemberInput) {
  const [row] = await db.insert(organizationMembers).values(input).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function getMembershipByUser(db: Db, userId: string) {
  return db.query.organizationMembers.findFirst({ where: eq(organizationMembers.userId, userId) });
}

export async function listMembers(db: Db, organizationId: string) {
  return db
    .select({
      membership: organizationMembers,
      user: { id: users.id, email: users.email, name: users.name },
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId));
}
