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
  patch: Partial<
    Pick<
      Organization,
      "name" | "plan" | "stripeCustomerId" | "stripeSubscriptionId" | "paymentFailedAt"
    >
  >,
): Promise<Organization | undefined> {
  const [row] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, id))
    .returning();
  return row;
}

/** Organizations still on a paid plan whose payment grace window elapsed. */
export async function listOrganizationsPastGrace(db: Db, graceDays: number) {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1_000);
  return db.query.organizations.findMany({
    where: (table, { and, isNotNull, lt, ne }) =>
      and(
        isNotNull(table.paymentFailedAt),
        lt(table.paymentFailedAt, cutoff),
        ne(table.plan, "free"),
      ),
  });
}

/** All organizations on the given plan with a Stripe customer. */
export async function listOrganizationsByPlan(db: Db, plan: Organization["plan"]) {
  return db.query.organizations.findMany({
    where: (table, { and, eq: eqOp, isNotNull }) =>
      and(eqOp(table.plan, plan), isNotNull(table.stripeCustomerId)),
  });
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
