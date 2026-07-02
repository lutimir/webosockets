import { eq } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { users, type User } from "../db/schema.js";

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash?: string | null;
}

export async function createUser(db: Db, input: CreateUserInput): Promise<User> {
  const [row] = await db.insert(users).values(input).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function getUserById(db: Db, id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function getUserByEmail(db: Db, email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}
