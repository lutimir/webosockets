import Link from "next/link";
import { redirect } from "next/navigation";

import { BillingPanel, type BillingInfo } from "@/components/billing";
import { getMe, internalJson } from "@/lib/internal";

export default async function BillingPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const { status, body } = await internalJson<BillingInfo>("/billing");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <Link href="/" className="text-sm text-indigo-400 hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Billing</h1>
      {status === 200 ? (
        <BillingPanel info={body} />
      ) : (
        <p className="text-zinc-400">Failed to load billing information.</p>
      )}
    </main>
  );
}
