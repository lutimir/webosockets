import { proxyJson } from "@/lib/proxy";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return proxyJson(null, "GET", `/projects/${slug}/stats`);
}
