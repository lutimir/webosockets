import { PLANS } from "@synckit/core";
import { sql } from "drizzle-orm";
import { type FastifyBaseLogger } from "fastify";
import { type Redis } from "ioredis";

import { type Db } from "../db/client.js";
import {
  countActiveEndUsers,
  listOrganizationsByPlan,
  listOrganizationsPastGrace,
  listProjectsByOrganization,
  rollupUsageDaily,
  updateOrganization,
} from "../repos/index.js";

import { invalidateOrganizationLimits, PAYMENT_GRACE_DAYS } from "./limits.js";
import { type BillingProvider } from "./provider.js";

/** Advisory lock id shared by all instances — only one runs the job. */
const METERING_LOCK_ID = 823_642;
const STRIPE_REPORT_MARKER = "billing:last-stripe-report";

export interface MeteringJobDeps {
  db: Db;
  redis: Redis;
  provider: BillingProvider | null;
  log: FastifyBaseLogger;
  intervalMs: number;
}

/**
 * Periodic billing job: rolls usage_events into usage_daily, downgrades
 * organizations whose payment grace elapsed, and (at most once a day)
 * reports MAU overage to the billing provider. A pg advisory transaction
 * lock guarantees a single running instance across the fleet.
 */
export class MeteringJob {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly deps: MeteringJobDeps) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.tick()
        .catch((error: unknown) => this.deps.log.error({ err: error }, "metering tick failed"))
        .finally(() => {
          this.running = false;
        });
    }, this.deps.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One run, guarded by the advisory lock. Exposed for tests. */
  async tick(): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${METERING_LOCK_ID}) as locked`,
      );
      if (!row?.locked) return false; // another instance holds the lock

      await rollupUsageDaily(tx);
      await this.downgradePastGrace();
      await this.maybeReportMeteredUsage();
      return true;
    });
  }

  /** Downgrades orgs whose payment failure is older than the grace window. */
  async downgradePastGrace(): Promise<number> {
    const expired = await listOrganizationsPastGrace(this.deps.db, PAYMENT_GRACE_DAYS);
    for (const organization of expired) {
      await updateOrganization(this.deps.db, organization.id, {
        plan: "free",
        paymentFailedAt: null,
        stripeSubscriptionId: null,
      });
      await invalidateOrganizationLimits(
        { db: this.deps.db, redis: this.deps.redis },
        organization.id,
      );
      this.deps.log.warn(
        { organizationId: organization.id },
        "organization downgraded to free after payment grace",
      );
    }
    return expired.length;
  }

  /** Reports pro-plan MAU overage to Stripe, at most once per 24h. */
  async maybeReportMeteredUsage(force = false): Promise<void> {
    if (!this.deps.provider) return;
    if (!force) {
      const marker = await this.deps.redis.set(
        STRIPE_REPORT_MARKER,
        new Date().toISOString(),
        "EX",
        24 * 3_600,
        "NX",
      );
      if (marker === null) return; // already reported within 24h
    }

    const organizations = await listOrganizationsByPlan(this.deps.db, "pro");
    const included = PLANS.pro.maxMau;
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);

    for (const organization of organizations) {
      const projects = await listProjectsByOrganization(this.deps.db, organization.id);
      let mau = 0;
      for (const project of projects) {
        mau += await countActiveEndUsers(this.deps.db, project.id, monthAgo);
      }
      const overage = Math.max(0, mau - included);
      if (overage > 0 && organization.stripeCustomerId) {
        await this.deps.provider.reportMeteredUsage(organization.stripeCustomerId, overage);
        this.deps.log.info(
          { organizationId: organization.id, overage },
          "reported MAU overage to billing provider",
        );
      }
    }
  }
}
