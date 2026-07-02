import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(sql: postgres.Sql): Db {
  return drizzle(sql, { schema });
}
