import { describe, expect, it } from "vitest";

import { checkWebhookUrl } from "./ssrf.js";

const blocked = async (url: string): Promise<boolean> => !(await checkWebhookUrl(url)).safe;

describe("checkWebhookUrl", () => {
  it("rejects malformed URLs and non-http(s) schemes", async () => {
    expect(await blocked("not a url")).toBe(true);
    expect(await blocked("ftp://example.com/hook")).toBe(true);
    expect(await blocked("file:///etc/passwd")).toBe(true);
    expect(await blocked("gopher://example.com")).toBe(true);
  });

  it("rejects URLs carrying credentials", async () => {
    expect(await blocked("https://user:pass@example.com/hook")).toBe(true);
    expect(await blocked("https://user@example.com/hook")).toBe(true);
  });

  it("rejects literal private, loopback, link-local and CGNAT IPv4", async () => {
    for (const host of [
      "10.0.0.1",
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
    ]) {
      expect(await blocked(`http://${host}/hook`), host).toBe(true);
    }
  });

  it("rejects private IPv6 and v4-mapped forms", async () => {
    // Both spellings of a v4-mapped address: URL normalizes dotted to hex.
    for (const host of ["[::1]", "[fe80::1]", "[fd00::1]", "[::ffff:10.0.0.1]", "[::ffff:a00:1]"]) {
      expect(await blocked(`http://${host}/hook`), host).toBe(true);
    }
  });

  it("rejects localhost hostnames", async () => {
    expect(await blocked("http://localhost:3000/hook")).toBe(true);
    expect(await blocked("http://api.localhost/hook")).toBe(true);
  });

  it("accepts public literal addresses", async () => {
    expect(await checkWebhookUrl("https://93.184.216.34/hook")).toEqual({ safe: true });
    expect(await checkWebhookUrl("http://172.32.0.1/hook")).toEqual({ safe: true });
    expect(await checkWebhookUrl("http://100.128.0.1/hook")).toEqual({ safe: true });
  });

  it("allowPrivate permits local receivers (dev/test)", async () => {
    expect(await checkWebhookUrl("http://127.0.0.1:9999/hook", { allowPrivate: true })).toEqual({
      safe: true,
    });
  });

  it("rejects hostnames that do not resolve", async () => {
    expect(await blocked(`https://${crypto.randomUUID()}.invalid/hook`)).toBe(true);
  });
});
