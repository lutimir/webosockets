import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

/** Identity of a customer's end user, carried by the client JWT. */
export interface ClientIdentity {
  /** SyncKit project id (DB uuid). */
  projectId: string;
  /** The user's id inside the customer's application. */
  endUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  projectId: z.uuid(),
  displayName: z.string().nullable().default(null),
  avatarUrl: z.string().nullable().default(null),
});

const encoder = new TextEncoder();

export async function signClientToken(
  secret: string,
  identity: ClientIdentity,
  ttlSeconds = 3_600,
): Promise<string> {
  return new SignJWT({
    projectId: identity.projectId,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.endUserId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(encoder.encode(secret));
}

/** Returns the verified identity, or undefined for any invalid/expired token. */
export async function verifyClientToken(
  secret: string,
  token: string,
): Promise<ClientIdentity | undefined> {
  try {
    // Pin HS256 — prevents algorithm-confusion attacks.
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ["HS256"] });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return undefined;
    return {
      projectId: claims.data.projectId,
      endUserId: claims.data.sub,
      displayName: claims.data.displayName,
      avatarUrl: claims.data.avatarUrl,
    };
  } catch {
    return undefined;
  }
}
