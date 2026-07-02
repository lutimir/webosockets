import postgres from "postgres";

import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { loadEnv } from "../env.js";

const TEST_DB_NAME = "synckit_test";

/**
 * Provisions an isolated `synckit_test` database (created on demand from the
 * database in DATABASE_URL), runs migrations and returns a connected client.
 */
export async function createTestDb(): Promise<{
  db: Db;
  sql: postgres.Sql;
  truncateAll: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const env = loadEnv();

  const admin = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await admin.unsafe(`create database ${TEST_DB_NAME}`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P04") throw error; // 42P04 = database already exists
  } finally {
    await admin.end();
  }

  const testUrl = new URL(env.DATABASE_URL);
  testUrl.pathname = `/${TEST_DB_NAME}`;
  await runMigrations(testUrl.toString());

  const sql = postgres(testUrl.toString(), { max: 5 });
  const db = createDb(sql);

  const truncateAll = async () => {
    await sql.unsafe(
      `truncate table
         webhook_endpoints, usage_events, notifications, comments, rooms,
         end_users, api_keys, projects, organization_members, users, organizations
       cascade`,
    );
  };

  return { db, sql, truncateAll, close: () => sql.end({ timeout: 5 }) };
}
