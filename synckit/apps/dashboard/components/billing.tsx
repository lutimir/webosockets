"use client";

import { useState } from "react";

import { Button, Card, CardTitle } from "./ui";

export interface BillingInfo {
  billingEnabled: boolean;
  plan: string;
  effectivePlan: string;
  grace: { failedAt: string; daysLeft: number } | null;
  usage: {
    mau: number;
    mauLimit: number;
    connections: number;
    connectionsLimit: number;
    projects: number;
    projectsLimit: number | null;
  };
  invoices: {
    id: string;
    total: number;
    currency: string;
    status: string;
    createdAt: string;
    hostedInvoiceUrl: string | null;
  }[];
}

function UsageBar({ label, value, limit }: { label: string; value: number; limit: number | null }) {
  const percent = limit === null ? 0 : Math.min(100, Math.round((value / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-400">
          {value} / {limit === null ? "∞" : limit}
          {limit !== null && ` (${percent}%)`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-500" : "bg-indigo-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const UPGRADE_TARGETS = [
  { plan: "pro", label: "Upgrade to Pro — €49/mo" },
  { plan: "scale", label: "Upgrade to Scale — €299/mo" },
] as const;

export function BillingPanel({ info }: { info: BillingInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(endpoint: string, payload?: unknown) {
    setBusy(endpoint);
    setError(null);
    const response = await fetch(endpoint, {
      method: "POST",
      ...(payload
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
        : {}),
    });
    const body = (await response.json()) as { url?: string; error?: { message?: string } };
    if (response.ok && body.url) {
      window.location.href = body.url;
      return;
    }
    setError(body.error?.message ?? "billing request failed");
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      {info.grace && (
        <div
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300"
        >
          Your last payment failed. Update your payment method within{" "}
          <strong>{info.grace.daysLeft} days</strong> or your organization will be downgraded to the
          free plan.
        </div>
      )}

      <Card>
        <CardTitle>Current plan</CardTitle>
        <p className="text-3xl font-semibold capitalize" data-testid="current-plan">
          {info.plan}
          {info.effectivePlan !== info.plan && (
            <span className="ml-2 text-base text-red-400">(limited to {info.effectivePlan})</span>
          )}
        </p>
        {info.billingEnabled ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {info.plan === "free" &&
              UPGRADE_TARGETS.map((target) => (
                <Button
                  key={target.plan}
                  disabled={busy !== null}
                  onClick={() => void go("/api/billing/checkout", { plan: target.plan })}
                >
                  {busy ? "…" : target.label}
                </Button>
              ))}
            {info.plan !== "free" && (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void go("/api/billing/portal")}
              >
                Manage subscription
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            Billing is not configured on this deployment (STRIPE_SECRET_KEY missing).
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </Card>

      <Card>
        <CardTitle>Usage</CardTitle>
        <div className="space-y-4">
          <UsageBar
            label="Monthly active users"
            value={info.usage.mau}
            limit={info.usage.mauLimit}
          />
          <UsageBar
            label="Concurrent connections"
            value={info.usage.connections}
            limit={info.usage.connectionsLimit}
          />
          <UsageBar label="Projects" value={info.usage.projects} limit={info.usage.projectsLimit} />
        </div>
      </Card>

      {info.invoices.length > 0 && (
        <Card>
          <CardTitle>Invoices</CardTitle>
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-zinc-800">
              {info.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-2">{new Date(invoice.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">
                    {(invoice.total / 100).toFixed(2)} {invoice.currency.toUpperCase()}
                  </td>
                  <td className="py-2 capitalize">{invoice.status}</td>
                  <td className="py-2 text-right">
                    {invoice.hostedInvoiceUrl && (
                      <a
                        className="text-indigo-400 hover:underline"
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
