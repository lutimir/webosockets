import { Card, CardTitle } from "@/components/ui";
import { CreateWebhookForm, EndpointRow } from "@/components/webhooks";
import { internalJson } from "@/lib/internal";

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  disabledAt: string | null;
}

export default async function WebhooksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { body } = await internalJson<{ endpoints: Endpoint[] }>(`/projects/${slug}/webhooks`);
  const endpoints = body.endpoints ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Webhooks</h1>
      <CreateWebhookForm slug={slug} />
      <Card>
        <CardTitle>Endpoints</CardTitle>
        {endpoints.length === 0 ? (
          <p className="text-sm text-zinc-500">No endpoints configured.</p>
        ) : (
          <div className="divide-y divide-zinc-800">
            {endpoints.map((endpoint) => (
              <EndpointRow key={endpoint.id} endpoint={endpoint} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
