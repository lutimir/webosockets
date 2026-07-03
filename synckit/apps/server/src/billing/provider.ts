import { type PlanId } from "@synckit/core";
import Stripe from "stripe";

/** A parsed, signature-verified billing webhook event. */
export interface BillingEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

export interface InvoiceSummary {
  id: string;
  total: number;
  currency: string;
  status: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
}

/**
 * Everything the app needs from a billing backend. Stripe in production,
 * a fake in tests — no real keys required to run the suite.
 */
export interface BillingProvider {
  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string>;
  createCheckoutSession(input: {
    customerId: string;
    organizationId: string;
    plan: PlanId;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Reports metered MAU overage for the current billing period. */
  reportMeteredUsage(customerId: string, quantity: number): Promise<void>;
  listInvoices(customerId: string): Promise<InvoiceSummary[]>;
  /** Returns the event when the signature is valid, undefined otherwise. */
  verifyWebhook(rawBody: Buffer, signature: string): Promise<BillingEvent | undefined>;
}

const PRICE_LOOKUP_KEYS: Partial<Record<PlanId, string>> = {
  pro: "synckit_pro_monthly",
  scale: "synckit_scale_monthly",
};
export const MAU_OVERAGE_LOOKUP_KEY = "synckit_pro_mau_overage";
/** Billing meter event name for MAU overage (Stripe usage-based billing). */
export const MAU_METER_EVENT = "synckit_mau_overage";

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async ensureCustomer(input: {
    organizationId: string;
    email: string;
    name: string;
  }): Promise<string> {
    const existing = await this.stripe.customers.search({
      query: `metadata["organizationId"]:"${input.organizationId}"`,
      limit: 1,
    });
    if (existing.data[0]) return existing.data[0].id;
    const created = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: { organizationId: input.organizationId },
    });
    return created.id;
  }

  private async priceByLookupKey(lookupKey: string): Promise<string> {
    const prices = await this.stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    const price = prices.data[0];
    if (!price) {
      throw new Error(`Stripe price "${lookupKey}" not found — run pnpm stripe:bootstrap`);
    }
    return price.id;
  }

  async createCheckoutSession(input: {
    customerId: string;
    organizationId: string;
    plan: PlanId;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const lookupKey = PRICE_LOOKUP_KEYS[input.plan];
    if (!lookupKey) throw new Error(`plan ${input.plan} is not self-serve`);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: await this.priceByLookupKey(lookupKey), quantity: 1 },
    ];
    // Pro carries a metered MAU-overage item.
    if (input.plan === "pro") {
      lineItems.push({ price: await this.priceByLookupKey(MAU_OVERAGE_LOOKUP_KEY) });
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId,
      line_items: lineItems,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { organizationId: input.organizationId, plan: input.plan },
      subscription_data: {
        metadata: { organizationId: input.organizationId, plan: input.plan },
      },
    });
    if (!session.url) throw new Error("Stripe returned no checkout url");
    return { url: session.url };
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async reportMeteredUsage(customerId: string, quantity: number): Promise<void> {
    await this.stripe.billing.meterEvents.create({
      event_name: MAU_METER_EVENT,
      payload: { stripe_customer_id: customerId, value: String(quantity) },
    });
  }

  async listInvoices(customerId: string): Promise<InvoiceSummary[]> {
    const invoices = await this.stripe.invoices.list({ customer: customerId, limit: 12 });
    return invoices.data.map((invoice) => ({
      id: invoice.id ?? "",
      total: invoice.total,
      currency: invoice.currency,
      status: invoice.status ?? "unknown",
      createdAt: new Date(invoice.created * 1_000).toISOString(),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    }));
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<BillingEvent | undefined> {
    try {
      const event = await this.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        this.webhookSecret,
      );
      return event as unknown as BillingEvent;
    } catch {
      return undefined;
    }
  }
}
