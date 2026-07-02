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
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
