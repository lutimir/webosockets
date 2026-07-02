import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-synckit-signature";
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Produces the `X-SyncKit-Signature` header value: `t=<unix>,v1=<hex>`. */
export function signWebhookPayload(secret: string, body: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * Verifies a webhook signature. The timestamp is covered by the HMAC and must
 * be within `toleranceSeconds` of now, which defeats replay attacks.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!match) return false;
  const [, timestampRaw, provided] = match;
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided ?? "", "hex");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
