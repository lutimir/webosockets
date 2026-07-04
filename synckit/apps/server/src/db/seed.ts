import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { loadEnv } from "../env.js";
import { hashPassword } from "../lib/password.js";
import {
  addMember,
  createApiKey,
  createComment,
  createNotification,
  createOrganization,
  createProject,
  createUser,
  getMembershipByUser,
  getOrganizationBySlug,
  getProjectBySlug,
  getUserByEmail,
  listApiKeysByProject,
  roomHasComments,
  upsertEndUser,
  upsertRoom,
} from "../repos/index.js";

import { createDb, type Db } from "./client.js";

/** Idempotent development seed — safe to run repeatedly. */
export async function seed(db: Db): Promise<void> {
  // Organization + owner user.
  const org =
    (await getOrganizationBySlug(db, "acme")) ??
    (await createOrganization(db, { name: "Acme Inc.", slug: "acme", plan: "pro" }));

  const owner =
    (await getUserByEmail(db, "demo@synckit.dev")) ??
    (await createUser(db, {
      email: "demo@synckit.dev",
      name: "Demo Owner",
      passwordHash: await hashPassword("demo1234"),
    }));

  const existingMembership = await getMembershipByUser(db, owner.id);
  if (!existingMembership) {
    await addMember(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  }

  // One dev and one prod project.
  const devProject =
    (await getProjectBySlug(db, org.id, "acme-app-dev")) ??
    (await createProject(db, {
      organizationId: org.id,
      name: "Acme App (dev)",
      slug: "acme-app-dev",
      environment: "dev",
    }));
  if (!(await getProjectBySlug(db, org.id, "acme-app-prod"))) {
    await createProject(db, {
      organizationId: org.id,
      name: "Acme App (prod)",
      slug: "acme-app-prod",
      environment: "prod",
    });
  }

  // API key for the dev project — printed exactly once, on first seed.
  const existingKeys = await listApiKeysByProject(db, devProject.id);
  if (existingKeys.length === 0) {
    const { key } = await createApiKey(db, { projectId: devProject.id, environment: "dev" });
    console.log("──────────────────────────────────────────────────────");
    console.log("Dev API key (store it now, it will not be shown again):");
    console.log(`  ${key}`);
    console.log("──────────────────────────────────────────────────────");
  }

  // End users, a room and a few comments.
  const [alice, bob] = await Promise.all(
    (
      [
        ["alice", "Alice Novak"],
        ["bob", "Bob Kovac"],
        ["carol", "Carol Danko"],
        ["dave", "Dave Urban"],
        ["erin", "Erin Slavik"],
      ] as const
    ).map(([externalId, displayName]) =>
      upsertEndUser(db, { projectId: devProject.id, externalId, displayName }),
    ),
  );
  if (!alice || !bob) throw new Error("seed users missing");

  const room = await upsertRoom(db, {
    projectId: devProject.id,
    externalId: "demo-board",
    metadata: { name: "Demo Board" },
  });

  if (!(await roomHasComments(db, room.id))) {
    const thread = await createComment(db, {
      roomId: room.id,
      endUserId: alice.id,
      body: "Can we ship this card by Friday?",
      anchor: { cardId: "card-1" },
    });
    await createComment(db, {
      roomId: room.id,
      endUserId: bob.id,
      body: "Yes — backend is done, polishing the UI now.",
      threadId: thread.id,
    });
    await createNotification(db, {
      endUserId: alice.id,
      type: "comment.replied",
      payload: { roomExternalId: room.externalId, threadId: thread.id },
    });
  }

  console.log("seed complete");
}

// Executed directly via `pnpm db:seed`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await seed(createDb(sql));
  } finally {
    await sql.end();
  }
}
