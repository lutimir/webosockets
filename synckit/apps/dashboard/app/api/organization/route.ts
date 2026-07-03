import { type NextRequest } from "next/server";

import { proxyJson } from "@/lib/proxy";

export function PATCH(request: NextRequest) {
  return proxyJson(request, "PATCH", "/organization");
}
