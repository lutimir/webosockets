import Link from "next/link";

import { Card, CardTitle } from "@/components/ui";
import { getMe } from "@/lib/internal";

export default async function BillingPage() {
  const me = await getMe();
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <Link href="/" className="text-sm text-indigo-400 hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <Card>
        <CardTitle>Current plan</CardTitle>
        <p className="text-3xl font-semibold capitalize">{me?.organization.plan ?? "free"}</p>
        <p className="mt-2 text-sm text-zinc-400">
          Plan management, usage-based billing and invoices arrive with the Stripe integration.
        </p>
      </Card>
    </main>
  );
}
