import { proxyJson } from "@/lib/proxy";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return proxyJson(null, "GET", `/invites/${token}`);
}
