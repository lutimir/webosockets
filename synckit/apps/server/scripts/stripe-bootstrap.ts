// Idempotently provisions SyncKit products, prices and the MAU billing meter
// in Stripe. Safe to run repeatedly: everything is looked up before creating.
//
//   STRIPE_SECRET_KEY=sk_test_… pnpm stripe:bootstrap
import Stripe from "stripe";

import { MAU_METER_EVENT, MAU_OVERAGE_LOOKUP_KEY } from "../src/billing/provider.js";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}
const stripe = new Stripe(secretKey);

async function ensureProduct(planId: string, name: string): Promise<Stripe.Product> {
  const found = await stripe.products.search({
    query: `metadata["synckit_plan"]:"${planId}" AND active:"true"`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0];
  console.log(`creating product ${name}`);
  return stripe.products.create({ name, metadata: { synckit_plan: planId } });
}

async function ensurePrice(
  lookupKey: string,
  create: () => Promise<Stripe.Price>,
): Promise<Stripe.Price> {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (found.data[0]) return found.data[0];
  console.log(`creating price ${lookupKey}`);
  return create();
}

async function ensureMeter(): Promise<Stripe.Billing.Meter> {
  const meters = await stripe.billing.meters.list({ status: "active", limit: 100 });
  const existing = meters.data.find((meter) => meter.event_name === MAU_METER_EVENT);
  if (existing) return existing;
  console.log(`creating billing meter ${MAU_METER_EVENT}`);
  return stripe.billing.meters.create({
    display_name: "SyncKit MAU overage",
    event_name: MAU_METER_EVENT,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
  });
}

const pro = await ensureProduct("pro", "SyncKit Pro");
const scale = await ensureProduct("scale", "SyncKit Scale");
const meter = await ensureMeter();

await ensurePrice("synckit_pro_monthly", () =>
  stripe.prices.create({
    product: pro.id,
    currency: "eur",
    unit_amount: 49_00,
    recurring: { interval: "month" },
    lookup_key: "synckit_pro_monthly",
  }),
);

await ensurePrice(MAU_OVERAGE_LOOKUP_KEY, () =>
  stripe.prices.create({
    product: pro.id,
    currency: "eur",
    unit_amount: 5, // €0.05 per MAU over the included 1000
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    lookup_key: MAU_OVERAGE_LOOKUP_KEY,
  }),
);

await ensurePrice("synckit_scale_monthly", () =>
  stripe.prices.create({
    product: scale.id,
    currency: "eur",
    unit_amount: 299_00,
    recurring: { interval: "month" },
    lookup_key: "synckit_scale_monthly",
  }),
);

console.log("Stripe bootstrap complete ✓");
