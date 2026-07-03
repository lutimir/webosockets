import { proxyJson } from "@/lib/proxy";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyJson(null, "GET", `/webhooks/${id}/deliveries`);
}
