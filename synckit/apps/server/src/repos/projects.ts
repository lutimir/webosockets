import { eq, and } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { projects, type Project } from "../db/schema.js";

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  slug: string;
  environment: "dev" | "prod";
}

export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function getProjectById(db: Db, id: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export async function getProjectBySlug(
  db: Db,
  organizationId: string,
  slug: string,
): Promise<Project | undefined> {
  return db.query.projects.findFirst({
    where: and(eq(projects.organizationId, organizationId), eq(projects.slug, slug)),
  });
}

export async function listProjectsByOrganization(
  db: Db,
  organizationId: string,
): Promise<Project[]> {
  return db.query.projects.findMany({ where: eq(projects.organizationId, organizationId) });
}
