import { type NextRequest } from "next/server";

import { proxyJson } from "@/lib/proxy";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return proxyJson(request, "POST", `/projects/${slug}/api-keys`);
}
