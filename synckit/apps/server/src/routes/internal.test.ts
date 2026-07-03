import { type FastifyInstance, type InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { type Db } from "../db/client.js";
import { loadEnv, type Env } from "../env.js";
import { verifyApiKey } from "../repos/index.js";
import { createTestDb } from "../test/db.js";

let db: Db;
let closeTestDb: () => Promise<void>;
let env: Env;
let app: FastifyInstance;
let sessionToken: string;
let projectSlug: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  closeTestDb = testDb.close;
  await testDb.truncateAll();

  env = loadEnv({ NODE_ENV: "test", DATABASE_URL: testDb.databaseUrl });
  app = await buildApp(env);
});

afterAll(async () => {
  await app.close();
  await closeTestDb();
});

function inject(options: InjectOptions & { session?: string | undefined }) {
  const { session, ...rest } = options;
  return app.inject({
    ...rest,
    headers: {
      "x-internal-secret": env.INTERNAL_API_SECRET,
      ...(session ? { "x-session-token": session } : {}),
      ...rest.headers,
    },
  });
}

describe("internal API auth boundary", () => {
  it("rejects calls without the internal secret", async () => {
    const response = await app.inject({ method: "GET", url: "/internal/me" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects session routes without a valid session", async () => {
    const response = await inject({ method: "GET", url: "/internal/me" });
    expect(response.statusCode).toBe(401);
  });
});

describe("signup → login → projects → keys flow", () => {
  it("signs up an owner with an organization and a session", async () => {
    const response = await inject({
      method: "POST",
      url: "/internal/auth/signup",
      payload: {
        email: "founder@example.com",
        name: "Founder",
        password: "hunter2hunter2",
        organizationName: "Test Co",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; organization: { slug: string }; role: string }>();
    expect(body.role).toBe("owner");
    sessionToken = body.token;

    const me = await inject({ method: "GET", url: "/internal/me", session: sessionToken });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { email: string } }>().user.email).toBe("founder@example.com");
  });

  it("rejects duplicate signups and wrong passwords", async () => {
    expect(
      (
        await inject({
          method: "POST",
          url: "/internal/auth/signup",
          payload: {
            email: "founder@example.com",
            name: "X",
            password: "hunter2hunter2",
            organizationName: "Y",
          },
        })
      ).statusCode,
    ).toBe(409);

    expect(
      (
        await inject({
          method: "POST",
          url: "/internal/auth/login",
          payload: { email: "founder@example.com", password: "wrong-password" },
        })
      ).statusCode,
    ).toBe(401);

    const login = await inject({
      method: "POST",
      url: "/internal/auth/login",
      payload: { email: "founder@example.com", password: "hunter2hunter2" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("creates a project, mints a key once and revokes it", async () => {
    const created = await inject({
      method: "POST",
      url: "/internal/projects",
      session: sessionToken,
      payload: { name: "My App", environment: "dev" },
    });
    expect(created.statusCode).toBe(200);
    projectSlug = created.json<{ project: { slug: string } }>().project.slug;

    const keyResponse = await inject({
      method: "POST",
      url: `/internal/projects/${projectSlug}/api-keys`,
      session: sessionToken,
    });
    const { key, id } = keyResponse.json<{ key: string; id: string }>();
    expect(key).toMatch(/^sk_dev_/);
    expect(await verifyApiKey(db, key)).toBeDefined();

    const listed = await inject({
      method: "GET",
      url: `/internal/projects/${projectSlug}/api-keys`,
      session: sessionToken,
    });
    expect(listed.json<{ keys: { id: string }[] }>().keys.some((k) => k.id === id)).toBe(true);

    await inject({
      method: "POST",
      url: `/internal/api-keys/${id}/revoke`,
      session: sessionToken,
    });
    expect(await verifyApiKey(db, key)).toBeUndefined();
  });

  it("serves project stats", async () => {
    const response = await inject({
      method: "GET",
      url: `/internal/projects/${projectSlug}/stats`,
      session: sessionToken,
    });
    expect(response.statusCode).toBe(200);
    const stats = response.json<{ activeConnections: number; messagesDaily: unknown[] }>();
    expect(stats.activeConnections).toBe(0);
    expect(Array.isArray(stats.messagesDaily)).toBe(true);
  });

  it("logout invalidates the session", async () => {
    const login = await inject({
      method: "POST",
      url: "/internal/auth/login",
      payload: { email: "founder@example.com", password: "hunter2hunter2" },
    });
    const { token } = login.json<{ token: string }>();
    await inject({ method: "POST", url: "/internal/auth/logout", session: token });
    expect((await inject({ method: "GET", url: "/internal/me", session: token })).statusCode).toBe(
      401,
    );
  });
});

describe("invites", () => {
  it("creates an invite and accepts it into the organization", async () => {
    const invite = await inject({
      method: "POST",
      url: "/internal/organization/invites",
      session: sessionToken,
      payload: { email: "teammate@example.com", role: "member" },
    });
    expect(invite.statusCode).toBe(200);
    const { link } = invite.json<{ link: string }>();
    const token = link.split("/invite/")[1]!;

    const info = await inject({ method: "GET", url: `/internal/invites/${token}` });
    expect(info.json<{ email: string }>().email).toBe("teammate@example.com");

    const accepted = await inject({
      method: "POST",
      url: `/internal/invites/${token}/accept`,
      payload: { name: "Teammate", password: "password123" },
    });
    expect(accepted.statusCode).toBe(200);

    const members = await inject({
      method: "GET",
      url: "/internal/organization/members",
      session: sessionToken,
    });
    expect(members.json<{ members: unknown[] }>().members).toHaveLength(2);

    // A used invite cannot be reused.
    expect((await inject({ method: "GET", url: `/internal/invites/${token}` })).statusCode).toBe(
      404,
    );
  });
});
