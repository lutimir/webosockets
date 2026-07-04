import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// OWASP-recommended scrypt parameters (N=2^17, r=8, p=1).
const N = 131_072;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

/** Format: scrypt$N$r$p$<salt b64>$<hash b64> — parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(hashB64 ?? "", "base64");
  const actual = await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  return expected.length > 0 && timingSafeEqual(expected, actual);
}
