import { type Comment, type JsonValue } from "@synckit/core";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import { type Db } from "../db/client.js";
import { comments, endUsers, type CommentRow } from "../db/schema.js";

const MAX_PAGE_SIZE = 100;

export interface CreateCommentInput {
  roomId: string;
  endUserId: string;
  body: string;
  threadId?: string | null;
  anchor?: JsonValue | null;
}

export async function createComment(db: Db, input: CreateCommentInput): Promise<CommentRow> {
  const [row] = await db
    .insert(comments)
    .values({
      roomId: input.roomId,
      endUserId: input.endUserId,
      body: input.body,
      threadId: input.threadId ?? null,
      anchor: input.anchor ?? null,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export async function getCommentById(db: Db, id: string): Promise<CommentRow | undefined> {
  return db.query.comments.findFirst({
    where: and(eq(comments.id, id), isNull(comments.deletedAt)),
  });
}

/**
 * Distinct authors of a thread (root + replies), used to fan out
 * notifications. Excludes soft-deleted comments.
 */
export async function listThreadParticipants(
  db: Db,
  threadRootId: string,
): Promise<{ endUserId: string; externalId: string }[]> {
  return db
    .selectDistinct({ endUserId: comments.endUserId, externalId: endUsers.externalId })
    .from(comments)
    .innerJoin(endUsers, eq(comments.endUserId, endUsers.id))
    .where(
      and(
        or(eq(comments.id, threadRootId), eq(comments.threadId, threadRootId)),
        isNull(comments.deletedAt),
      ),
    );
}

export async function roomHasComments(db: Db, roomId: string): Promise<boolean> {
  const row = await db.query.comments.findFirst({ where: eq(comments.roomId, roomId) });
  return row !== undefined;
}

export interface CommentPage {
  items: (CommentRow & { endUserExternalId: string })[];
  /** Pass back as `cursor` to fetch the next page; undefined on the last page. */
  nextCursor: string | undefined;
}

/**
 * Lists non-deleted comments of a room in creation order (uuid v7 ids are
 * time-ordered) with cursor-based pagination.
 */
export async function listCommentsByRoom(
  db: Db,
  roomId: string,
  options: { cursor?: string | undefined; limit?: number } = {},
): Promise<CommentPage> {
  const limit = Math.min(options.limit ?? 50, MAX_PAGE_SIZE);
  const rows = await db
    .select({ comment: comments, endUserExternalId: endUsers.externalId })
    .from(comments)
    .innerJoin(endUsers, eq(comments.endUserId, endUsers.id))
    .where(
      and(
        eq(comments.roomId, roomId),
        isNull(comments.deletedAt),
        options.cursor ? gt(comments.id, options.cursor) : undefined,
      ),
    )
    .orderBy(asc(comments.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({ ...row.comment, endUserExternalId: row.endUserExternalId })),
    nextCursor: rows.length > limit ? page.at(-1)?.comment.id : undefined,
  };
}

export async function setCommentResolved(
  db: Db,
  id: string,
  resolved: boolean,
): Promise<CommentRow | undefined> {
  const [row] = await db
    .update(comments)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning();
  return row;
}

export async function softDeleteComment(db: Db, id: string): Promise<CommentRow | undefined> {
  const [row] = await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning();
  return row;
}

/** Maps a DB row to the wire format used by the protocol and REST API. */
export function toWireComment(row: CommentRow, endUserExternalId: string): Comment {
  return {
    id: row.id,
    threadId: row.threadId,
    endUserId: endUserExternalId,
    body: row.body,
    anchor: (row.anchor ?? null) as JsonValue | null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
