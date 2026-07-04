import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { claimStripeEvent, updateOrganization } from "../repos/index.js";

import { invalidateOrganizationLimits } from "./limits.js";
import { type BillingEvent } from "./provider.js";

const subscriptionObjectSchema = z.object({
  id: z.string().optional(),
  customer: z.string().optional(),
  metadata: z
    .object({ organizationId: z.string().optional(), plan: z.string().optional() })
    .optional(),
});

const checkoutSessionSchema = z.object({
  subscription: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  metadata: z
    .object({ organizationId: z.string().optional(), plan: z.string().optional() })
    .optional(),
});

const invoiceSchema = z.object({
  customer: z.string().nullable().optional(),
  subscription_details: z
    .object({ metadata: z.object({ organizationId: z.string().optional() }).optional() })
    .nullable()
    .optional(),
  parent: z
    .object({
      subscription_details: z
        .object({ metadata: z.object({ organizationId: z.string().optional() }).optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

function planFrom(value: string | undefined): "pro" | "scale" | undefined {
  return value === "pro" || value === "scale" ? value : undefined;
}

/**
 * Applies a verified billing event. Exposed separately from the route so
 * tests can drive it with fixture events.
 */
export async function applyBillingEvent(app: FastifyInstance, event: BillingEvent): Promise<void> {
  const isNew = await claimStripeEvent(app.db, event.id, event.type);
  if (!isNew) {
    app.log.info({ eventId: event.id }, "duplicate billing event ignored");
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = checkoutSessionSchema.parse(event.data.object);
      const organizationId = session.metadata?.organizationId;
      const plan = planFrom(session.metadata?.plan);
      if (!organizationId || !plan) return;
      await updateOrganization(app.db, organizationId, {
        plan,
        stripeSubscriptionId: session.subscription ?? null,
        stripeCustomerId: session.customer ?? null,
        paymentFailedAt: null,
      });
      await invalidateOrganizationLimits({ db: app.db, redis: app.redis }, organizationId);
      app.log.info({ organizationId, plan }, "organization upgraded via checkout");
      return;
    }
    case "customer.subscription.updated": {
      const subscription = subscriptionObjectSchema.parse(event.data.object);
      const organizationId = subscription.metadata?.organizationId;
      const plan = planFrom(subscription.metadata?.plan);
      if (!organizationId || !plan) return;
      await updateOrganization(app.db, organizationId, {
        plan,
        stripeSubscriptionId: subscription.id ?? null,
      });
      await invalidateOrganizationLimits({ db: app.db, redis: app.redis }, organizationId);
      return;
    }
    case "customer.subscription.deleted": {
      const subscription = subscriptionObjectSchema.parse(event.data.object);
      const organizationId = subscription.metadata?.organizationId;
      if (!organizationId) return;
      await updateOrganization(app.db, organizationId, {
        plan: "free",
        stripeSubscriptionId: null,
        paymentFailedAt: null,
      });
      await invalidateOrganizationLimits({ db: app.db, redis: app.redis }, organizationId);
      app.log.info({ organizationId }, "organization downgraded (subscription deleted)");
      return;
    }
    case "invoice.paid": {
      const invoice = invoiceSchema.parse(event.data.object);
      const organizationId =
        invoice.parent?.subscription_details?.metadata?.organizationId ??
        invoice.subscription_details?.metadata?.organizationId;
      if (!organizationId) return;
      await updateOrganization(app.db, organizationId, { paymentFailedAt: null });
      await invalidateOrganizationLimits({ db: app.db, redis: app.redis }, organizationId);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = invoiceSchema.parse(event.data.object);
      const organizationId =
        invoice.parent?.subscription_details?.metadata?.organizationId ??
        invoice.subscription_details?.metadata?.organizationId;
      if (!organizationId) return;
      await updateOrganization(app.db, organizationId, { paymentFailedAt: new Date() });
      await invalidateOrganizationLimits({ db: app.db, redis: app.redis }, organizationId);
      app.log.warn({ organizationId }, "payment failed — grace window started");
      return;
    }
    default:
      app.log.info({ type: event.type }, "unhandled billing event type");
  }
}

/** POST /billing/stripe/webhook — raw-body scope for signature verification. */
export function billingWebhookRoutes(app: FastifyInstance): void {
  // Keep the raw payload: Stripe signatures are over the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );

  app.post(
    "/stripe/webhook",
    { schema: { hide: true }, config: { rateLimit: false } },
    async (request, reply) => {
      if (!app.billing.provider) {
        return reply
          .status(503)
          .send({ error: { code: "billing_disabled", message: "no provider" } });
      }
      const signature = request.headers["stripe-signature"];
      const event =
        typeof signature === "string"
          ? await app.billing.provider.verifyWebhook(request.body as Buffer, signature)
          : undefined;
      if (!event) {
        return reply
          .status(400)
          .send({ error: { code: "invalid_signature", message: "signature verification failed" } });
      }
      await applyBillingEvent(app, event);
      return { received: true };
    },
  );
}
