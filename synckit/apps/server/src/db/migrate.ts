import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { loadEnv } from "../env.js";

function migrationsFolder(): string {
  const url = new URL("../../drizzle", import.meta.url);
  // Under jsdom-based test environments import.meta.url is not file-scheme.
  if (url.protocol !== "file:") return path.resolve(process.cwd(), "drizzle");
  return fileURLToPath(url);
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: migrationsFolder() });
  } finally {
    await sql.end();
  }
}

// Executed directly via `pnpm db:migrate`.
if (import.meta.url.startsWith("file:") && process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
  console.log("migrations applied");
}
