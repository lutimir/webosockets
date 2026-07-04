import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://synckit:synckit@localhost:5432/synckit"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16).default("dev-only-change-me-0000000000000000"),
  INTERNAL_API_SECRET: z.string().min(16).default("dev-only-change-me-1111111111111111"),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
  // ─── Realtime tuning (sane production defaults; overridden in tests) ──────
  WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WS_MAX_CONNECTIONS_PER_END_USER: z.coerce.number().int().positive().default(5),
  WS_MAX_CONNECTIONS_PER_PROJECT: z.coerce.number().int().positive().default(1_000),
  WS_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(50),
  WS_BACKPRESSURE_SOFT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  WS_BACKPRESSURE_HARD_BYTES: z.coerce.number().int().positive().default(5_242_880),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // ─── REST API ──────────────────────────────────────────────────────────────
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
  CLIENT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  // ─── Webhooks ──────────────────────────────────────────────────────────────
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  WEBHOOK_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(2_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // ─── Billing ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  METERING_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /** Dev/test escape hatch: permit webhook targets on private addresses. */
  WEBHOOKS_ALLOW_PRIVATE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
