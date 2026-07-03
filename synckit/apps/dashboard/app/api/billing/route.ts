import { proxyJson } from "@/lib/proxy";

export function GET() {
  return proxyJson(null, "GET", "/billing");
}
