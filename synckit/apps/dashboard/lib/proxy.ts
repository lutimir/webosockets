import { NextResponse, type NextRequest } from "next/server";

import { internalFetch, SESSION_COOKIE } from "./internal";

interface ProxyOptions {
  /** Copy body.token into the session cookie (login/signup/invite accept). */
  setSession?: boolean;
  clearSession?: boolean;
}

/** Forwards a browser request to the internal API and mirrors the response. */
export async function proxyJson(
  request: NextRequest | null,
  method: string,
  path: string,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  const body = request && method !== "GET" ? await request.text() : undefined;
  const response = await internalFetch(path, { method, ...(body ? { body } : {}) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  const { token, ...safe } = data;
  const next = NextResponse.json(options.setSession ? safe : data, {
    status: response.status,
  });

  if (options.setSession && response.ok && typeof token === "string") {
    next.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  }
  if (options.clearSession) {
    next.cookies.delete(SESSION_COOKIE);
  }
  return next;
}
