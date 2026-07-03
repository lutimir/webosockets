import { proxyJson } from "@/lib/proxy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; externalId: string }> },
) {
  const { slug, externalId } = await context.params;
  return proxyJson(null, "GET", `/projects/${slug}/rooms/${encodeURIComponent(externalId)}`);
}
