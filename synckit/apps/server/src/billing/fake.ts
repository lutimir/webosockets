import { type BillingEvent, type BillingProvider, type InvoiceSummary } from "./provider.js";

export const FAKE_WEBHOOK_SIGNATURE = "valid-signature";

/**
 * In-memory BillingProvider for tests and keyless development. Webhook
 * signatures are the literal FAKE_WEBHOOK_SIGNATURE; the body is the event.
 */
export class FakeBillingProvider implements BillingProvider {
  customers: { organizationId: string; email: string; id: string }[] = [];
  checkouts: { customerId: string; plan: string }[] = [];
  meteredReports: { customerId: string; quantity: number }[] = [];

  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string> {
    const existing = this.customers.find(
      (customer) => customer.organizationId === input.organizationId,
    );
    if (existing) return Promise.resolve(existing.id);
    const id = `cus_fake_${this.customers.length + 1}`;
    this.customers.push({ organizationId: input.organizationId, email: input.email, id });
    return Promise.resolve(id);
  }

  createCheckoutSession(input: { customerId: string; plan: string }): Promise<{ url: string }> {
    this.checkouts.push({ customerId: input.customerId, plan: input.plan });
    return Promise.resolve({ url: `https://checkout.fake/session/${this.checkouts.length}` });
  }

  createPortalSession(): Promise<{ url: string }> {
    return Promise.resolve({ url: "https://portal.fake/session" });
  }

  reportMeteredUsage(customerId: string, quantity: number): Promise<void> {
    this.meteredReports.push({ customerId, quantity });
    return Promise.resolve();
  }

  listInvoices(): Promise<InvoiceSummary[]> {
    return Promise.resolve([]);
  }

  verifyWebhook(rawBody: Buffer, signature: string): Promise<BillingEvent | undefined> {
    if (signature !== FAKE_WEBHOOK_SIGNATURE) return Promise.resolve(undefined);
    try {
      return Promise.resolve(JSON.parse(rawBody.toString("utf8")) as BillingEvent);
    } catch {
      return Promise.resolve(undefined);
    }
  }
}
