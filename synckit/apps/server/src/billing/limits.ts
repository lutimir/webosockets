import { PLANS, type PlanId, type PlanLimits } from "@synckit/core";
import { type Redis } from "ioredis";

import { type Db } from "../db/client.js";
import { type Organization } from "../db/schema.js";
import { getOrganizationById, getProjectById, listProjectsByOrganization } from "../repos/index.js";

export const PAYMENT_GRACE_DAYS = 7;
const CACHE_TTL_SECONDS = 60;

export interface LimitsDeps {
  db: Db;
  redis: Redis;
}

export interface ResolvedLimits {
  organizationId: string;
  plan: PlanId;
  /** Plan after applying the payment-failure grace window. */
  effectivePlan: PlanId;
  limits: PlanLimits;
}

/** The plan that actually applies: paid plans decay to free after grace. */
export function effectivePlanOf(organization: Organization, now = Date.now()): PlanId {
  if (
    organization.paymentFailedAt &&
    now - organization.paymentFailedAt.getTime() > PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1_000
  ) {
    return "free";
  }
  return organization.plan;
}

function cacheKey(projectId: string): string {
  return `limits:project:${projectId}`;
}

/**
 * Limits for a project, cached in Redis for 60 s so the WS connect path
 * never adds two DB round-trips.
 */
export async function getProjectLimits(
  deps: LimitsDeps,
  projectId: string,
): Promise<ResolvedLimits | undefined> {
  const cached = await deps.redis.get(cacheKey(projectId)).catch(() => null);
  if (cached) return JSON.parse(cached) as ResolvedLimits;

  const project = await getProjectById(deps.db, projectId);
  const organization = project && (await getOrganizationById(deps.db, project.organizationId));
  if (!project || !organization) return undefined;

  const effectivePlan = effectivePlanOf(organization);
  const resolved: ResolvedLimits = {
    organizationId: organization.id,
    plan: organization.plan,
    effectivePlan,
    limits: PLANS[effectivePlan],
  };
  await deps.redis
    .set(cacheKey(projectId), JSON.stringify(resolved), "EX", CACHE_TTL_SECONDS)
    .catch(() => undefined);
  return resolved;
}

/** Drops cached limits of every project in the organization. */
export async function invalidateOrganizationLimits(
  deps: LimitsDeps,
  organizationId: string,
): Promise<void> {
  const projects = await listProjectsByOrganization(deps.db, organizationId);
  if (projects.length === 0) return;
  await deps.redis.del(...projects.map((project) => cacheKey(project.id))).catch(() => undefined);
}

function connectionsKey(projectId: string): string {
  return `conns:${projectId}`;
}

/**
 * Cross-instance concurrent-connection accounting in Redis. Returns the new
 * count. The key carries a 1h TTL refreshed on every change, so counter
 * drift from crashed instances heals itself.
 */
export async function incrementConnections(redis: Redis, projectId: string): Promise<number> {
  const key = connectionsKey(projectId);
  const count = await redis.incr(key);
  await redis.expire(key, 3_600);
  return count;
}

export async function decrementConnections(redis: Redis, projectId: string): Promise<void> {
  const key = connectionsKey(projectId);
  const value = await redis.decr(key);
  if (value < 0) await redis.set(key, 0, "EX", 3_600);
}

export async function currentConnections(redis: Redis, projectId: string): Promise<number> {
  const value = await redis.get(connectionsKey(projectId));
  return value ? Math.max(0, Number(value)) : 0;
}
