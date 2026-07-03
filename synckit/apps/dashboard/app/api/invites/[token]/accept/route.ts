import { type NextRequest } from "next/server";

import { proxyJson } from "@/lib/proxy";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return proxyJson(request, "POST", `/invites/${token}/accept`, { setSession: true });
}
