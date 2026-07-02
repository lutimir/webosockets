import { randomBytes } from "node:crypto";

import { and, arrayContains, eq, isNull } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { webhookEndpoints, type WebhookEndpoint } from "../db/schema.js";

export async function createWebhookEndpoint(
  db: Db,
  input: { projectId: string; url: string; events: string[] },
): Promise<WebhookEndpoint> {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      projectId: input.projectId,
      url: input.url,
      events: input.events,
      secret: `whsec_${randomBytes(24).toString("base64url")}`,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Active endpoints of a project subscribed to the given event. */
export async function listActiveEndpointsForEvent(
  db: Db,
  projectId: string,
  event: string,
): Promise<WebhookEndpoint[]> {
  return db.query.webhookEndpoints.findMany({
    where: and(
      eq(webhookEndpoints.projectId, projectId),
      isNull(webhookEndpoints.disabledAt),
      arrayContains(webhookEndpoints.events, [event]),
    ),
  });
}

export async function listWebhookEndpointsByProject(
  db: Db,
  projectId: string,
): Promise<WebhookEndpoint[]> {
  return db.query.webhookEndpoints.findMany({
    where: eq(webhookEndpoints.projectId, projectId),
  });
}

export async function disableWebhookEndpoint(
  db: Db,
  id: string,
): Promise<WebhookEndpoint | undefined> {
  const [row] = await db
    .update(webhookEndpoints)
    .set({ disabledAt: new Date() })
    .where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.disabledAt)))
    .returning();
  return row;
}
