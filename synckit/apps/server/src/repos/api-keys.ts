import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { apiKeys, type ApiKey } from "../db/schema.js";

const KEY_PREFIX_LENGTH = 8;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Splits `sk_dev_abc…` into its parts; returns undefined for malformed keys. */
export function parseApiKey(key: string): { environment: string; secret: string } | undefined {
  const match = /^sk_(dev|prod)_([A-Za-z0-9_-]{16,})$/.exec(key);
  if (!match) return undefined;
  const [, environment, secret] = match;
  if (!environment || !secret) return undefined;
  return { environment, secret };
}

export interface CreatedApiKey {
  /** Full plaintext key — shown to the customer exactly once. */
  key: string;
  record: ApiKey;
}

export async function createApiKey(
  db: Db,
  input: { projectId: string; environment: "dev" | "prod"; scopes?: string[] },
): Promise<CreatedApiKey> {
  const secret = randomBytes(24).toString("base64url");
  const key = `sk_${input.environment}_${secret}`;
  const [record] = await db
    .insert(apiKeys)
    .values({
      projectId: input.projectId,
      prefix: secret.slice(0, KEY_PREFIX_LENGTH),
      keyHash: sha256Hex(key),
      scopes: input.scopes ?? [],
    })
    .returning();
  if (!record) throw new Error("insert returned no row");
  return { key, record };
}

/**
 * Verifies a plaintext key and returns its active record, or undefined when
 * the key is unknown or revoked. Hash comparison is timing-safe.
 */
export async function verifyApiKey(db: Db, key: string): Promise<ApiKey | undefined> {
  const parsed = parseApiKey(key);
  if (!parsed) return undefined;

  const candidates = await db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.prefix, parsed.secret.slice(0, KEY_PREFIX_LENGTH)),
      isNull(apiKeys.revokedAt),
    ),
  });

  const hash = Buffer.from(sha256Hex(key), "hex");
  return candidates.find((candidate) => {
    const stored = Buffer.from(candidate.keyHash, "hex");
    return stored.length === hash.length && timingSafeEqual(stored, hash);
  });
}

export async function revokeApiKey(db: Db, id: string): Promise<ApiKey | undefined> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning();
  return row;
}

/** Updates last_used_at, throttled to at most once per minute per key. */
export async function touchApiKey(db: Db, id: string): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(eq(apiKeys.id, id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, oneMinuteAgo))),
    );
}

export async function listApiKeysByProject(db: Db, projectId: string): Promise<ApiKey[]> {
  return db.query.apiKeys.findMany({ where: eq(apiKeys.projectId, projectId) });
}
