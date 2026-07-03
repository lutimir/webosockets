import { proxyJson } from "@/lib/proxy";

export function POST() {
  return proxyJson(null, "POST", "/billing/portal");
}
