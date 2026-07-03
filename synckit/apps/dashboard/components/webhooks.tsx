"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "./ui";

export function CreateWebhookForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const events = ["comment.created", "comment.resolved"].filter(
      (name) => form.get(name) === "on",
    );
    const response = await fetch(`/api/projects/${slug}/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: form.get("url"), events }),
    });
    const body = (await response.json()) as { secret?: string; error?: { message?: string } };
    if (response.ok && body.secret) {
      setSecret(body.secret);
      router.refresh();
    } else {
      setError(body.error?.message ?? "failed to create endpoint");
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <Field label="Endpoint URL">
          <Input
            name="url"
            type="url"
            placeholder="https://example.com/webhooks/synckit"
            required
          />
        </Field>
        <div className="flex gap-5 text-sm text-zinc-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="comment.created" defaultChecked /> comment.created
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="comment.resolved" defaultChecked /> comment.resolved
          </label>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit">Add endpoint</Button>
      </form>
      {secret && (
        <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm">
          <p className="mb-1 text-amber-300">
            Signing secret (shown once — use it to verify X-SyncKit-Signature):
          </p>
          <code className="font-mono text-emerald-300">{secret}</code>
        </div>
      )}
    </Card>
  );
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

export function EndpointRow({
  endpoint,
}: {
  endpoint: { id: string; url: string; events: string[]; disabledAt: string | null };
}) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  async function toggleDeliveries() {
    if (deliveries) {
      setDeliveries(null);
      return;
    }
    const response = await fetch(`/api/webhooks/${endpoint.id}/deliveries`);
    const body = (await response.json()) as { deliveries?: Delivery[] };
    setDeliveries(body.deliveries ?? []);
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-sm">{endpoint.url}</p>
          <p className="text-xs text-zinc-500">
            {endpoint.events.join(", ")}
            {endpoint.disabledAt && <span className="ml-2 text-red-400">disabled</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void toggleDeliveries()}>
            {deliveries ? "Hide log" : "Deliveries"}
          </Button>
          {!endpoint.disabledAt && (
            <Button
              variant="danger"
              onClick={() => {
                void fetch(`/api/webhooks/${endpoint.id}/disable`, { method: "POST" }).then(() =>
                  router.refresh(),
                );
              }}
            >
              Disable
            </Button>
          )}
        </div>
      </div>
      {deliveries && (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="pb-2 font-medium">Event</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Attempts</th>
              <th className="pb-2 font-medium">HTTP</th>
              <th className="pb-2 font-medium">When</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-zinc-500">
                  No deliveries yet.
                </td>
              </tr>
            )}
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td className="py-2">{delivery.event}</td>
                <td
                  className={
                    delivery.status === "delivered"
                      ? "text-emerald-400"
                      : delivery.status === "failed"
                        ? "text-red-400"
                        : "text-amber-400"
                  }
                >
                  {delivery.status}
                </td>
                <td>{delivery.attempts}</td>
                <td>{delivery.responseStatus ?? "—"}</td>
                <td className="text-zinc-500">{new Date(delivery.createdAt).toLocaleString()}</td>
                <td className="text-right">
                  {delivery.status !== "pending" && (
                    <button
                      type="button"
                      className="cursor-pointer text-indigo-400 hover:underline"
                      onClick={() => {
                        void fetch(`/api/webhook-deliveries/${delivery.id}/resend`, {
                          method: "POST",
                        }).then(() => toggleDeliveries().then(() => toggleDeliveries()));
                      }}
                    >
                      Resend
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
