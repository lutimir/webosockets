import { type NextRequest } from "next/server";

import { proxyJson } from "@/lib/proxy";

export function POST(request: NextRequest) {
  return proxyJson(request, "POST", "/auth/signup", { setSession: true });
}
