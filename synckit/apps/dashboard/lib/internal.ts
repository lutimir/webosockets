import { cookies } from "next/headers";

const SERVER_URL = process.env.SERVER_INTERNAL_URL ?? "http://localhost:4000";
const SECRET = process.env.INTERNAL_API_SECRET ?? "dev-only-change-me-1111111111111111";

export const SESSION_COOKIE = "synckit_session";

export interface Me {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string; plan: string };
  role: "owner" | "admin" | "member";
}

/** Server-side call to the internal API, forwarding the dashboard session. */
export async function internalFetch(
  path: string,
  init: RequestInit & { session?: string | null } = {},
): Promise<Response> {
  const { session, ...rest } = init;
  const sessionToken =
    session !== undefined ? session : ((await cookies()).get(SESSION_COOKIE)?.value ?? null);
  return fetch(`${SERVER_URL}/internal${path}`, {
    ...rest,
    headers: {
      // A json content-type with an empty body is rejected by Fastify.
      ...(rest.body ? { "content-type": "application/json" } : {}),
      "x-internal-secret": SECRET,
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...rest.headers,
    },
    cache: "no-store",
  });
}

export async function internalJson<T>(
  path: string,
  init: RequestInit & { session?: string | null } = {},
): Promise<{ status: number; body: T }> {
  const response = await internalFetch(path, init);
  return { status: response.status, body: (await response.json()) as T };
}

/** The signed-in user, or null (pages redirect to /login on null). */
export async function getMe(): Promise<Me | null> {
  const response = await internalFetch("/me");
  if (!response.ok) return null;
  return (await response.json()) as Me;
}
