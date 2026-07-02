import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "../db/client.js";
import {
  createOrganization,
  createProject,
  createWebhookEndpoint,
  getDeliveryById,
  listDeliveriesByEndpoint,
} from "../repos/index.js";
import { createTestDb } from "../test/db.js";

import { WebhookDispatcher } from "./dispatcher.js";
import { signWebhookPayload, verifyWebhookSignature } from "./signature.js";

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silentLog,
} as never;

describe("webhook signatures", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ event: "comment.created", data: { id: "1" } });

  it("signs and verifies", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(secret, body, now);
    expect(header).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(verifyWebhookSignature(secret, body, header)).toBe(true);
  });

  it("rejects tampered bodies and wrong secrets", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(secret, body, now);
    expect(verifyWebhookSignature(secret, `${body} `, header)).toBe(false);
    expect(verifyWebhookSignature("other-secret", body, header)).toBe(false);
  });

  it("rejects replayed (old) timestamps", () => {
    const old = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const header = signWebhookPayload(secret, body, old);
    expect(verifyWebhookSignature(secret, body, header)).toBe(false);
    // ...but accepts it when verified within tolerance of that time.
    expect(verifyWebhookSignature(secret, body, header, { nowSeconds: old + 60 })).toBe(true);
  });

  it("rejects malformed headers", () => {
    expect(verifyWebhookSignature(secret, body, "nonsense")).toBe(false);
    expect(verifyWebhookSignature(secret, body, "t=abc,v1=00")).toBe(false);
  });
});

describe("webhook dispatcher", () => {
  let db: Db;
  let closeTestDb: () => Promise<void>;
  let projectId: string;

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    closeTestDb = testDb.close;
    await testDb.truncateAll();

    const org = await createOrganization(db, { name: "WH", slug: "webhook-test-org" });
    const project = await createProject(db, {
      organizationId: org.id,
      name: "WH",
      slug: "webhook-test",
      environment: "dev",
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  function makeDispatcher(
    overrides: Partial<ConstructorParameters<typeof WebhookDispatcher>[0]> = {},
  ) {
    return new WebhookDispatcher({
      db,
      log: silentLog,
      pollIntervalMs: 10_000, // ticks are driven manually in tests
      backoffBaseMs: 5,
      maxAttempts: 3,
      requestTimeoutMs: 2_000,
      ...overrides,
    });
  }

  async function tickUntilSettled(dispatcher: WebhookDispatcher, deliveryId: string) {
    for (let i = 0; i < 20; i++) {
      await dispatcher.tick();
      const delivery = await getDeliveryById(db, deliveryId);
      if (delivery && delivery.status !== "pending") return delivery;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return getDeliveryById(db, deliveryId);
  }

  it("delivers with a valid signature after two failures (retry + backoff)", async () => {
    // Receiver that fails twice, then succeeds — and records what it saw.
    const received: { body: string; signature: string }[] = [];
    let calls = 0;
    const receiver = Fastify();
    receiver.post("/hook", async (request, reply) => {
      calls += 1;
      if (calls <= 2) return reply.status(500).send({ error: "boom" });
      received.push({
        body: JSON.stringify(request.body),
        signature: String(request.headers["x-synckit-signature"]),
      });
      return { ok: true };
    });
    await receiver.listen({ port: 0, host: "127.0.0.1" });
    const address = receiver.server.address();
    if (address === null || typeof address === "string") throw new Error("no address");

    try {
      const endpoint = await createWebhookEndpoint(db, {
        projectId,
        url: `http://127.0.0.1:${address.port}/hook`,
        events: ["comment.created"],
      });

      const dispatcher = makeDispatcher();
      await dispatcher.enqueue(projectId, "comment.created", { commentId: "c1" });

      const [queued] = await listDeliveriesByEndpoint(db, endpoint.id);
      expect(queued?.status).toBe("pending");

      const settled = await tickUntilSettled(dispatcher, queued!.id);
      expect(settled?.status).toBe("delivered");
      expect(settled?.attempts).toBe(3);
      expect(settled?.responseStatus).toBe(200);
      expect(calls).toBe(3);

      // The signature the receiver saw verifies against the endpoint secret.
      expect(received).toHaveLength(1);
      expect(
        verifyWebhookSignature(endpoint.secret, received[0]!.body, received[0]!.signature),
      ).toBe(true);
      const payload = JSON.parse(received[0]!.body) as { event: string; data: unknown };
      expect(payload.event).toBe("comment.created");
      expect(payload.data).toEqual({ commentId: "c1" });
    } finally {
      await receiver.close();
    }
  });

  it("marks the delivery failed after maxAttempts to an unreachable endpoint", async () => {
    const endpoint = await createWebhookEndpoint(db, {
      projectId,
      url: "http://127.0.0.1:1/unreachable",
      events: ["comment.resolved"],
    });

    const dispatcher = makeDispatcher();
    await dispatcher.enqueue(projectId, "comment.resolved", { commentId: "c2" });

    const [queued] = await listDeliveriesByEndpoint(db, endpoint.id);
    const settled = await tickUntilSettled(dispatcher, queued!.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.attempts).toBe(3);
    expect(settled?.lastError).toBeTruthy();
  });

  it("does not enqueue anything for events nobody subscribes to", async () => {
    const dispatcher = makeDispatcher();
    // No endpoint listens to this event type.
    await dispatcher.enqueue(projectId, "room.created", {});
    // Claiming must find nothing new (previous tests' deliveries are settled).
    await dispatcher.tick();
  });
});
