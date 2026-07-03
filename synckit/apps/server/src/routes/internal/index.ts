import { timingSafeEqual } from "node:crypto";

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { type Organization, type Project, type User } from "../../db/schema.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  countActiveEndUsers,
  createApiKey,
  createInvite,
  createOrganization,
  createProject,
  createSession,
  createUser,
  createWebhookEndpoint,
  dailyUsage,
  deleteSession,
  disableWebhookEndpoint,
  getApiKeyById,
  getCommentById,
  getMembershipByUser,
  getOpenInviteByToken,
  getOrganizationById,
  getProjectBySlug,
  getRoomByExternalId,
  getRoomById,
  getSessionUser,
  getUserByEmail,
  getWebhookEndpointById,
  listApiKeysByProject,
  listCommentsByRoom,
  listDeliveriesByEndpoint,
  listMembers,
  listProjectsByOrganization,
  listRoomsByProject,
  listWebhookEndpointsByProject,
  markInviteAccepted,
  addMember,
  resendDelivery,
  revokeApiKey,
  softDeleteComment,
  sumUsage,
  toWireComment,
  updateOrganization,
} from "../../repos/index.js";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "project"}-${Math.random().toString(36).slice(2, 6)}`;
}

interface SessionContext {
  user: User;
  organization: Organization;
  role: "owner" | "admin" | "member";
}

/**
 * Internal API for the dashboard. Never exposed to SDK customers: every call
 * must carry the shared INTERNAL_API_SECRET; user-scoped routes additionally
 * carry the dashboard session token.
 */
export function internalRoutes(app: FastifyInstance): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  const secretBuffer = Buffer.from(app.env.INTERNAL_API_SECRET);
  routes.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const provided = Buffer.from(String(request.headers["x-internal-secret"] ?? ""));
    if (provided.length !== secretBuffer.length || !timingSafeEqual(provided, secretBuffer)) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "bad secret" } });
    }
  });

  async function sessionContext(request: FastifyRequest): Promise<SessionContext | undefined> {
    const token = request.headers["x-session-token"];
    if (typeof token !== "string" || token.length === 0) return undefined;
    const resolved = await getSessionUser(app.db, token);
    if (!resolved) return undefined;
    const membership = await getMembershipByUser(app.db, resolved.user.id);
    if (!membership) return undefined;
    const organization = await getOrganizationById(app.db, membership.organizationId);
    if (!organization) return undefined;
    return { user: resolved.user, organization, role: membership.role };
  }

  /** Wraps a handler with session resolution; replies 401 when absent. */
  function withSession<T>(
    handler: (context: SessionContext, request: FastifyRequest, reply: FastifyReply) => Promise<T>,
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const context = await sessionContext(request);
      if (!context) {
        return reply
          .status(401)
          .send({ error: { code: "unauthorized", message: "invalid session" } });
      }
      return handler(context, request, reply);
    };
  }

  async function projectOf(context: SessionContext, slug: string): Promise<Project | undefined> {
    return getProjectBySlug(app.db, context.organization.id, slug);
  }

  const meShape = (context: SessionContext) => ({
    user: { id: context.user.id, email: context.user.email, name: context.user.name },
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      slug: context.organization.slug,
      plan: context.organization.plan,
    },
    role: context.role,
  });

  // ─── Auth ───────────────────────────────────────────────────────────────────

  routes.post(
    "/auth/signup",
    {
      schema: {
        hide: true,
        body: z.object({
          email: z.email(),
          name: z.string().min(1).max(200),
          password: z.string().min(8).max(200),
          organizationName: z.string().min(1).max(200),
        }),
      },
    },
    async (request, reply) => {
      if (await getUserByEmail(app.db, request.body.email)) {
        return reply
          .status(409)
          .send({ error: { code: "conflict", message: "email already registered" } });
      }
      const user = await createUser(app.db, {
        email: request.body.email,
        name: request.body.name,
        passwordHash: await hashPassword(request.body.password),
      });
      const organization = await createOrganization(app.db, {
        name: request.body.organizationName,
        slug: slugify(request.body.organizationName),
      });
      await addMember(app.db, { organizationId: organization.id, userId: user.id, role: "owner" });
      const { token } = await createSession(app.db, user.id);
      return { token, ...meShape({ user, organization, role: "owner" }) };
    },
  );

  routes.post(
    "/auth/login",
    {
      schema: {
        hide: true,
        body: z.object({ email: z.email(), password: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const user = await getUserByEmail(app.db, request.body.email);
      if (
        !user?.passwordHash ||
        !(await verifyPassword(request.body.password, user.passwordHash))
      ) {
        return reply
          .status(401)
          .send({ error: { code: "unauthorized", message: "invalid credentials" } });
      }
      const membership = await getMembershipByUser(app.db, user.id);
      const organization =
        membership && (await getOrganizationById(app.db, membership.organizationId));
      if (!membership || !organization) {
        return reply
          .status(401)
          .send({ error: { code: "unauthorized", message: "no organization" } });
      }
      const { token } = await createSession(app.db, user.id);
      return { token, ...meShape({ user, organization, role: membership.role }) };
    },
  );

  routes.post("/auth/logout", { schema: { hide: true } }, async (request) => {
    const token = request.headers["x-session-token"];
    if (typeof token === "string" && token) await deleteSession(app.db, token);
    return { ok: true };
  });

  routes.get(
    "/me",
    { schema: { hide: true } },
    withSession((context) => Promise.resolve(meShape(context))),
  );

  // ─── Projects & stats ───────────────────────────────────────────────────────

  routes.get(
    "/projects",
    { schema: { hide: true } },
    withSession(async (context) => {
      const projects = await listProjectsByOrganization(app.db, context.organization.id);
      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          slug: project.slug,
          environment: project.environment,
        })),
      };
    }),
  );

  routes.post(
    "/projects",
    {
      schema: {
        hide: true,
        body: z.object({
          name: z.string().min(1).max(200),
          environment: z.enum(["dev", "prod"]).default("dev"),
        }),
      },
    },
    withSession(async (context, request) => {
      const body = request.body as { name: string; environment: "dev" | "prod" };
      const project = await createProject(app.db, {
        organizationId: context.organization.id,
        name: body.name,
        slug: slugify(body.name),
        environment: body.environment,
      });
      return { project: { id: project.id, name: project.name, slug: project.slug } };
    }),
  );

  routes.get(
    "/projects/:slug/stats",
    { schema: { hide: true, params: z.object({ slug: z.string() }) } },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });

      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const [activeUsers30d, messages24h, usage] = await Promise.all([
        countActiveEndUsers(app.db, project.id, monthAgo),
        sumUsage(app.db, { projectId: project.id, kind: "message", from: dayAgo, to: new Date() }),
        dailyUsage(app.db, project.id, "message", 30),
      ]);
      return {
        project: { id: project.id, name: project.name, slug: project.slug },
        activeConnections: app.realtime.manager.connectionCountForProject(project.id),
        activeUsers30d,
        messages24h,
        messagesDaily: usage,
      };
    }),
  );

  // ─── API keys ───────────────────────────────────────────────────────────────

  routes.get(
    "/projects/:slug/api-keys",
    { schema: { hide: true, params: z.object({ slug: z.string() }) } },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });
      const keys = await listApiKeysByProject(app.db, project.id);
      return {
        keys: keys.map((key) => ({
          id: key.id,
          prefix: key.prefix,
          scopes: key.scopes,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          revokedAt: key.revokedAt?.toISOString() ?? null,
          createdAt: key.createdAt.toISOString(),
        })),
      };
    }),
  );

  routes.post(
    "/projects/:slug/api-keys",
    { schema: { hide: true, params: z.object({ slug: z.string() }) } },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });
      const { key, record } = await createApiKey(app.db, {
        projectId: project.id,
        environment: project.environment,
      });
      return { key, id: record.id, prefix: record.prefix };
    }),
  );

  routes.post(
    "/api-keys/:id/revoke",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    withSession(async (context, request, reply) => {
      const { id } = request.params as { id: string };
      const apiKey = await getApiKeyById(app.db, id);
      const project = apiKey && (await projectBelongs(context, apiKey.projectId));
      if (!apiKey || !project) {
        return reply.status(404).send({ error: { code: "not_found", message: "key" } });
      }
      await revokeApiKey(app.db, id);
      return { ok: true };
    }),
  );

  async function projectBelongs(
    context: SessionContext,
    projectId: string,
  ): Promise<Project | undefined> {
    const projects = await listProjectsByOrganization(app.db, context.organization.id);
    return projects.find((project) => project.id === projectId);
  }

  // ─── Rooms & moderation ─────────────────────────────────────────────────────

  routes.get(
    "/projects/:slug/rooms",
    { schema: { hide: true, params: z.object({ slug: z.string() }) } },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });
      const rooms = await listRoomsByProject(app.db, project.id);
      return {
        rooms: rooms.map((room) => ({
          externalId: room.externalId,
          createdAt: room.createdAt.toISOString(),
        })),
      };
    }),
  );

  routes.get(
    "/projects/:slug/rooms/:externalId",
    {
      schema: {
        hide: true,
        params: z.object({ slug: z.string(), externalId: z.string() }),
      },
    },
    withSession(async (context, request, reply) => {
      const { slug, externalId } = request.params as { slug: string; externalId: string };
      const project = await projectOf(context, slug);
      const room = project && (await getRoomByExternalId(app.db, project.id, externalId));
      if (!project || !room) {
        return reply.status(404).send({ error: { code: "not_found", message: "room" } });
      }
      const [presence, comments] = await Promise.all([
        app.realtime.hub.getPresence(project.id, externalId),
        listCommentsByRoom(app.db, room.id, { limit: 100 }),
      ]);
      return {
        room: { externalId: room.externalId, createdAt: room.createdAt.toISOString() },
        presence,
        comments: comments.items.map((item) => toWireComment(item, item.endUserExternalId)),
      };
    }),
  );

  routes.post(
    "/comments/:id/delete",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    withSession(async (context, request, reply) => {
      const { id } = request.params as { id: string };
      const comment = await getCommentById(app.db, id);
      const room = comment && (await getRoomById(app.db, comment.roomId));
      const project = room && (await projectBelongs(context, room.projectId));
      if (!comment || !room || !project) {
        return reply.status(404).send({ error: { code: "not_found", message: "comment" } });
      }
      await softDeleteComment(app.db, id);
      return { ok: true };
    }),
  );

  // ─── Webhooks ───────────────────────────────────────────────────────────────

  routes.get(
    "/projects/:slug/webhooks",
    { schema: { hide: true, params: z.object({ slug: z.string() }) } },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });
      const endpoints = await listWebhookEndpointsByProject(app.db, project.id);
      return {
        endpoints: endpoints.map((endpoint) => ({
          id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          disabledAt: endpoint.disabledAt?.toISOString() ?? null,
          createdAt: endpoint.createdAt.toISOString(),
        })),
      };
    }),
  );

  routes.post(
    "/projects/:slug/webhooks",
    {
      schema: {
        hide: true,
        params: z.object({ slug: z.string() }),
        body: z.object({
          url: z.url().max(1_000),
          events: z.array(z.string().min(1)).min(1).max(10),
        }),
      },
    },
    withSession(async (context, request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = request.body as { url: string; events: string[] };
      const project = await projectOf(context, slug);
      if (!project)
        return reply.status(404).send({ error: { code: "not_found", message: "project" } });
      const endpoint = await createWebhookEndpoint(app.db, {
        projectId: project.id,
        url: body.url,
        events: body.events,
      });
      // The signing secret is shown exactly once, like API keys.
      return { id: endpoint.id, secret: endpoint.secret };
    }),
  );

  routes.post(
    "/webhooks/:id/disable",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    withSession(async (context, request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = await getWebhookEndpointById(app.db, id);
      const project = endpoint && (await projectBelongs(context, endpoint.projectId));
      if (!endpoint || !project) {
        return reply.status(404).send({ error: { code: "not_found", message: "endpoint" } });
      }
      await disableWebhookEndpoint(app.db, id);
      return { ok: true };
    }),
  );

  routes.get(
    "/webhooks/:id/deliveries",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    withSession(async (context, request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = await getWebhookEndpointById(app.db, id);
      const project = endpoint && (await projectBelongs(context, endpoint.projectId));
      if (!endpoint || !project) {
        return reply.status(404).send({ error: { code: "not_found", message: "endpoint" } });
      }
      const deliveries = await listDeliveriesByEndpoint(app.db, id);
      return {
        deliveries: deliveries.map((delivery) => ({
          id: delivery.id,
          event: delivery.event,
          status: delivery.status,
          attempts: delivery.attempts,
          responseStatus: delivery.responseStatus,
          lastError: delivery.lastError,
          createdAt: delivery.createdAt.toISOString(),
        })),
      };
    }),
  );

  routes.post(
    "/webhook-deliveries/:id/resend",
    { schema: { hide: true, params: z.object({ id: z.uuid() }) } },
    withSession(async (context, request, reply) => {
      const { id } = request.params as { id: string };
      // Ownership chain: delivery → endpoint → project → organization.
      const { getDeliveryById } = await import("../../repos/index.js");
      const delivery = await getDeliveryById(app.db, id);
      const endpoint = delivery && (await getWebhookEndpointById(app.db, delivery.endpointId));
      const project = endpoint && (await projectBelongs(context, endpoint.projectId));
      if (!delivery || !endpoint || !project) {
        return reply.status(404).send({ error: { code: "not_found", message: "delivery" } });
      }
      await resendDelivery(app.db, id);
      return { ok: true };
    }),
  );

  // ─── Organization ───────────────────────────────────────────────────────────

  routes.get(
    "/organization/members",
    { schema: { hide: true } },
    withSession(async (context) => {
      const members = await listMembers(app.db, context.organization.id);
      return {
        members: members.map((member) => ({
          userId: member.user.id,
          email: member.user.email,
          name: member.user.name,
          role: member.membership.role,
        })),
      };
    }),
  );

  routes.patch(
    "/organization",
    { schema: { hide: true, body: z.object({ name: z.string().min(1).max(200) }) } },
    withSession(async (context, request) => {
      const body = request.body as { name: string };
      await updateOrganization(app.db, context.organization.id, { name: body.name });
      return { ok: true };
    }),
  );

  routes.post(
    "/organization/invites",
    {
      schema: {
        hide: true,
        body: z.object({ email: z.email(), role: z.enum(["admin", "member"]).default("member") }),
      },
    },
    withSession(async (context, request) => {
      const body = request.body as { email: string; role: "admin" | "member" };
      const invite = await createInvite(app.db, {
        organizationId: context.organization.id,
        email: body.email,
        role: body.role,
      });
      const link = `${app.env.DASHBOARD_ORIGIN}/invite/${invite.token}`;
      // SMTP arrives with production hardening — for now the link is logged.
      app.log.info({ inviteLink: link, email: body.email }, "organization invite created");
      console.log(`Invite for ${body.email}: ${link}`);
      return { ok: true, link };
    }),
  );

  routes.get(
    "/invites/:token",
    { schema: { hide: true, params: z.object({ token: z.string() }) } },
    async (request, reply) => {
      const { token } = request.params;
      const invite = await getOpenInviteByToken(app.db, token);
      const organization = invite && (await getOrganizationById(app.db, invite.organizationId));
      if (!invite || !organization) {
        return reply.status(404).send({ error: { code: "not_found", message: "invite" } });
      }
      return { email: invite.email, role: invite.role, organizationName: organization.name };
    },
  );

  routes.post(
    "/invites/:token/accept",
    {
      schema: {
        hide: true,
        params: z.object({ token: z.string() }),
        body: z.object({ name: z.string().min(1).max(200), password: z.string().min(8).max(200) }),
      },
    },
    async (request, reply) => {
      const { token } = request.params;
      const body = request.body;
      const invite = await getOpenInviteByToken(app.db, token);
      const organization = invite && (await getOrganizationById(app.db, invite.organizationId));
      if (!invite || !organization) {
        return reply.status(404).send({ error: { code: "not_found", message: "invite" } });
      }
      if (await getUserByEmail(app.db, invite.email)) {
        return reply
          .status(409)
          .send({ error: { code: "conflict", message: "email already registered" } });
      }
      const user = await createUser(app.db, {
        email: invite.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
      });
      await addMember(app.db, {
        organizationId: organization.id,
        userId: user.id,
        role: invite.role,
      });
      await markInviteAccepted(app.db, invite.id);
      const { token: sessionToken } = await createSession(app.db, user.id);
      return {
        token: sessionToken,
        ...meShape({ user, organization, role: invite.role }),
      };
    },
  );
}
