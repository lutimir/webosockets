import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for customer-supplied webhook URLs: only http(s), no
 * credentials, and the host must not resolve to loopback/private/link-local
 * address space. Checked at endpoint creation AND before every delivery, so
 * DNS records that later flip to an internal address are still refused.
 */

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  // Anything that is not a clean dotted quad is treated as private (blocked).
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet > 255)) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique local fc00::/7
    lower.startsWith("fd")
  );
}

/**
 * Extracts the IPv4 embedded in a v4-mapped IPv6 address. URL parsing
 * normalizes `::ffff:10.0.0.1` to the hex form `::ffff:a00:1`, so both
 * spellings must be handled.
 */
function mappedIpv4(lower: string): string | undefined {
  if (!lower.startsWith("::ffff:")) return undefined;
  const rest = lower.slice(7);
  if (rest.includes(".")) return rest;
  const groups = rest.split(":");
  if (groups.length < 1 || groups.length > 2) return undefined;
  const numbers = groups.map((group) => Number.parseInt(group, 16));
  if (numbers.some((value) => Number.isNaN(value) || value > 0xffff)) return undefined;
  const [hi = 0, lo = 0] = numbers.length === 2 ? numbers : [0, numbers[0]];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const lower = address.toLowerCase();
  const embedded = mappedIpv4(lower);
  if (embedded !== undefined) return isPrivateIpv4(embedded);
  return isPrivateIpv6(lower);
}

export type SsrfVerdict = { safe: true } | { safe: false; reason: string };

/** `allowInsecure` permits localhost targets — tests and local dev only. */
export async function checkWebhookUrl(
  rawUrl: string,
  options: { allowPrivate?: boolean } = {},
): Promise<SsrfVerdict> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "invalid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { safe: false, reason: "only http(s) URLs are allowed" };
  }
  if (url.username || url.password) {
    return { safe: false, reason: "URLs with credentials are not allowed" };
  }
  if (options.allowPrivate) return { safe: true };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    return isPrivateAddress(hostname)
      ? { safe: false, reason: "target resolves to a private address" }
      : { safe: true };
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { safe: false, reason: "target resolves to a private address" };
  }

  try {
    const results = await lookup(hostname, { all: true });
    for (const result of results) {
      if (isPrivateAddress(result.address)) {
        return { safe: false, reason: "target resolves to a private address" };
      }
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "hostname does not resolve" };
  }
}
