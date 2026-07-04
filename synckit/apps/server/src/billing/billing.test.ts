import { randomUUID } from "node:crypto";

import { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { type Db } from "../db/client.js";
import { endUsers } from "../db/schema.js";
import { loadEnv, type Env } from "../env.js";
import { signClientToken } from "../lib/tokens.js";
import {
  createApiKey,
  createOrganization,
  createProject,
  createSession,
  createUser,
  addMember,
  getOrganizationById,
  recordUsage,
  updateOrganization,
} from "../repos/index.js";
import { createTestDb } from "../test/db.js";
import { TestClient } from "../test/ws.js";

import { FakeBillingProvider, FAKE_WEBHOOK_SIGNATURE } from "./fake.js";
import { effectivePlanOf } from "./limits.js";
import { MeteringJob } from "./metering.js";

let db: Db;
let closeTestDb: () => Promise<void>;
let env: Env;
let app: FastifyInstance;
let fake: FakeBillingProvider;

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: testDb.databaseUrl });
  app = await buildApp(env);
  await app.listen({ port: 0, host: "127.0.0.1" });
  // Swap in the fake provider — no Stripe keys needed anywhere in CI.
  fake = new FakeBillingProvider();
  app.billing.provider = fake;
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

async function fixtureOrg(plan: "free" | "pro" = "free") {
  const suffix = randomUUID().slice(0, 8);
  const org = await createOrganization(db, { name: "B", slug: `billing-${suffix}`, plan });
  const project = await createProject(db, {
    organizationId: org.id,
    name: "B",
    slug: `billing-${suffix}`,
    environment: "dev",
  });
  return { org, project };
}

function webhook(
  event: { id: string; type: string; data: { object: unknown } },
  signature?: string,
) {
  return app.inject({
    method: "POST",
    url: "/billing/stripe/webhook",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature ?? FAKE_WEBHOOK_SIGNATURE,
    },
    payload: JSON.stringify(event),
  });
}

describe("stripe webhook", () => {
  it("rejects invalid signatures", async () => {
    const response = await webhook(
      { id: "evt_bad", type: "checkout.session.completed", data: { object: {} } },
      "wrong-signature",
    );
    expect(response.statusCode).toBe(400);
  });

  it("applies checkout.session.completed and is idempotent per event id", async () => {
    const { org } = await fixtureOrg("free");
    const event = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          subscription: "sub_123",
          customer: "cus_123",
          metadata: { organizationId: org.id, plan: "pro" },
        },
      },
    };

    expect((await webhook(event)).statusCode).toBe(200);
    let updated = await getOrganizationById(db, org.id);
    expect(updated?.plan).toBe("pro");
    expect(updated?.stripeSubscriptionId).toBe("sub_123");

    // Same event id with different content — must be a no-op.
    const replayed = {
      ...event,
      data: {
        object: { ...event.data.object, metadata: { organizationId: org.id, plan: "scale" } },
      },
    };
    expect((await webhook(replayed)).statusCode).toBe(200);
    updated = await getOrganizationById(db, org.id);
    expect(updated?.plan).toBe("pro");
  });

  it("tracks payment failure and recovery", async () => {
    const { org } = await fixtureOrg("pro");
    const failed = await webhook({
      id: `evt_${randomUUID()}`,
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_x",
          parent: { subscription_details: { metadata: { organizationId: org.id } } },
        },
      },
    });
    expect(failed.statusCode).toBe(200);
    expect((await getOrganizationById(db, org.id))?.paymentFailedAt).not.toBeNull();

    await webhook({
      id: `evt_${randomUUID()}`,
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_x",
          parent: { subscription_details: { metadata: { organizationId: org.id } } },
        },
      },
    });
    expect((await getOrganizationById(db, org.id))?.paymentFailedAt).toBeNull();
  });

  it("downgrades on subscription.deleted", async () => {
    const { org } = await fixtureOrg("pro");
    await webhook({
      id: `evt_${randomUUID()}`,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_del", metadata: { organizationId: org.id } } },
    });
    expect((await getOrganizationById(db, org.id))?.plan).toBe("free");
  });
});

describe("grace window", () => {
  it("effectivePlanOf degrades to free after 7 days, not before", async () => {
    const { org } = await fixtureOrg("pro");
    const recent = { ...org, paymentFailedAt: new Date(Date.now() - 2 * 24 * 3_600_000) };
    const expired = { ...org, paymentFailedAt: new Date(Date.now() - 8 * 24 * 3_600_000) };
    expect(effectivePlanOf(recent)).toBe("pro");
    expect(effectivePlanOf(expired)).toBe("free");
  });

  it("the metering job persists the downgrade after grace", async () => {
    const { org } = await fixtureOrg("pro");
    await updateOrganization(db, org.id, {
      paymentFailedAt: new Date(Date.now() - 8 * 24 * 3_600_000),
    });
    const downgraded = await app.billing.metering.downgradePastGrace();
    expect(downgraded).toBeGreaterThanOrEqual(1);
    const after = await getOrganizationById(db, org.id);
    expect(after?.plan).toBe("free");
    expect(after?.paymentFailedAt).toBeNull();
  });
});

describe("plan enforcement", () => {
  it("closes WS connections above the plan's concurrent limit with 4403", async () => {
    const { project } = await fixtureOrg("free"); // free = 10 concurrent
    const token = await signClientToken(env.JWT_SECRET, {
      projectId: project.id,
      endUserId: "conn-user",
      displayName: null,
      avatarUrl: null,
    });

    // Distinct end users to stay clear of the per-user connection cap.
    const clients: TestClient[] = [];
    try {
      for (let i = 0; i < 10; i++) {
        const userToken = await signClientToken(env.JWT_SECRET, {
          projectId: project.id,
          endUserId: `conn-user-${i}`,
          displayName: null,
          avatarUrl: null,
        });
        const client = await TestClient.connect(app, userToken);
        client.send({ type: "ping" });
        await client.waitFor("pong");
        clients.push(client);
      }

      const eleventh = await TestClient.connect(app, token);
      expect(await eleventh.waitForClose()).toBe(4403);
    } finally {
      for (const client of clients) client.close();
    }
  });

  it("returns 402 from POST /v1/tokens for NEW users beyond the MAU limit", async () => {
    const { project } = await fixtureOrg("free"); // free = 100 MAU
    const { key } = await createApiKey(db, { projectId: project.id, environment: "dev" });

    // Bulk-provision exactly the included MAU.
    await db.insert(endUsers).values(
      Array.from({ length: 100 }, (_, i) => ({
        projectId: project.id,
        externalId: `mau-user-${i}`,
      })),
    );

    const denied = await app.inject({
      method: "POST",
      url: "/v1/tokens",
      headers: { authorization: `Bearer ${key}` },
      payload: { externalUserId: "one-too-many" },
    });
    expect(denied.statusCode).toBe(402);
    expect(denied.json<{ error: { message: string } }>().error.message).toContain("upgrade");

    // Existing users keep working.
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/tokens",
      headers: { authorization: `Bearer ${key}` },
      payload: { externalUserId: "mau-user-5" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("blocks a second project on the free plan with 402", async () => {
    const suffix = randomUUID().slice(0, 8);
    const org = await createOrganization(db, { name: "P", slug: `proj-limit-${suffix}` });
    const user = await createUser(db, { email: `owner-${suffix}@example.com`, name: "O" });
    await addMember(db, { organizationId: org.id, userId: user.id, role: "owner" });
    const { token: session } = await createSession(db, user.id);

    const create = (name: string) =>
      app.inject({
        method: "POST",
        url: "/internal/projects",
        headers: { "x-internal-secret": env.INTERNAL_API_SECRET, "x-session-token": session },
        payload: { name, environment: "dev" },
      });

    expect((await create("First")).statusCode).toBe(200);
    const second = await create("Second");
    expect(second.statusCode).toBe(402);
  });
});

describe("metering job", () => {
  it("rolls usage_events into usage_daily idempotently under the advisory lock", async () => {
    const { project } = await fixtureOrg();
    await recordUsage(db, { projectId: project.id, kind: "message", quantity: 7 });
    await recordUsage(db, { projectId: project.id, kind: "message", quantity: 3 });

    expect(await app.billing.metering.tick()).toBe(true);
    const first = await db.query.usageDaily.findMany({
      where: (table, { eq }) => eq(table.projectId, project.id),
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.total).toBe(10);

    // Re-run: same totals, no duplicates.
    expect(await app.billing.metering.tick()).toBe(true);
    const second = await db.query.usageDaily.findMany({
      where: (table, { eq }) => eq(table.projectId, project.id),
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.total).toBe(10);
  });

  it("reports pro MAU overage to the provider", async () => {
    const { org, project } = await fixtureOrg("pro");
    await updateOrganization(db, org.id, { stripeCustomerId: "cus_overage" });
    await db.insert(endUsers).values(
      Array.from({ length: 1_005 }, (_, i) => ({
        projectId: project.id,
        externalId: `pro-mau-${i}`,
      })),
    );

    const job = new MeteringJob({
      db,
      redis: app.redis,
      provider: fake,
      log: app.log,
      intervalMs: 60_000,
    });
    await job.maybeReportMeteredUsage(true);

    const report = fake.meteredReports.find((entry) => entry.customerId === "cus_overage");
    expect(report?.quantity).toBe(5);
  });
});

describe("checkout via internal API", () => {
  it("creates a provider customer and returns the checkout url", async () => {
    const suffix = randomUUID().slice(0, 8);
    const org = await createOrganization(db, { name: "C", slug: `checkout-${suffix}` });
    const user = await createUser(db, { email: `buyer-${suffix}@example.com`, name: "B" });
    await addMember(db, { organizationId: org.id, userId: user.id, role: "owner" });
    const { token: session } = await createSession(db, user.id);

    const response = await app.inject({
      method: "POST",
      url: "/internal/billing/checkout",
      headers: { "x-internal-secret": env.INTERNAL_API_SECRET, "x-session-token": session },
      payload: { plan: "pro" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toContain("https://checkout.fake/");

    expect((await getOrganizationById(db, org.id))?.stripeCustomerId).toMatch(/^cus_fake_/);
    expect(fake.checkouts.at(-1)?.plan).toBe("pro");
  });
});
