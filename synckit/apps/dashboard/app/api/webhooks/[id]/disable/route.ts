import { proxyJson } from "@/lib/proxy";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyJson(null, "POST", `/webhooks/${id}/disable`);
}
