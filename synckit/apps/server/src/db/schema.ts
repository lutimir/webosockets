import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

export const planEnum = pgEnum("plan", ["free", "pro", "scale", "enterprise"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "member"]);
export const environmentEnum = pgEnum("environment", ["dev", "prod"]);
export const usageKindEnum = pgEnum("usage_kind", ["connection_minutes", "message", "mau"]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  ...timestamps,
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Nullable so OAuth-only accounts can exist later.
  passwordHash: text("password_hash"),
  ...timestamps,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_members_org_user_idx").on(table.organizationId, table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    environment: environmentEnum("environment").notNull().default("dev"),
    ...timestamps,
  },
  (table) => [uniqueIndex("projects_org_slug_idx").on(table.organizationId, table.slug)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** First 8 chars of the random part — used to locate the key on auth. */
    prefix: text("prefix").notNull(),
    /** sha256 hex of the full key. The plaintext key is shown exactly once. */
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("api_keys_prefix_idx").on(table.prefix)],
);

export const endUsers = pgTable(
  "end_users",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The user's id inside the customer's application. */
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => [uniqueIndex("end_users_project_external_idx").on(table.projectId, table.externalId)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (table) => [uniqueIndex("rooms_project_external_idx").on(table.projectId, table.externalId)],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    /** Root comment of the thread; null when this comment starts the thread. */
    threadId: uuid("thread_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    endUserId: uuid("end_user_id")
      .notNull()
      .references(() => endUsers.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Arbitrary selector describing what the comment is anchored to. */
    anchor: jsonb("anchor"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("comments_room_idx").on(table.roomId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    endUserId: uuid("end_user_id")
      .notNull()
      .references(() => endUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("notifications_end_user_idx").on(table.endUserId)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: usageKindEnum("kind").notNull(),
    quantity: integer("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_project_occurred_idx").on(table.projectId, table.occurredAt)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Secret used to HMAC-sign deliveries (X-SyncKit-Signature). */
    secret: text("secret").notNull(),
    /** Event names this endpoint subscribes to, e.g. "comment.created". */
    events: text("events").array().notNull().default([]),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("webhook_endpoints_project_idx").on(table.projectId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex of the session token; the plaintext lives in the cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("member"),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("organization_invites_org_idx").on(table.organizationId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** When the delivery becomes due; doubles as a lease while processing. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    responseStatus: integer("response_status"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt)],
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type EndUser = typeof endUsers.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type OrganizationInvite = typeof organizationInvites.$inferSelect;
