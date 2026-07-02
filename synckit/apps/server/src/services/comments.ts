import { type Comment, type JsonValue, type Notification as NotificationWire } from "@synckit/core";

import { type Db } from "../db/client.js";
import { type Notification } from "../db/schema.js";
import { type RoomHub } from "../realtime/room-hub.js";
import {
  createComment,
  createNotification,
  getCommentById,
  getEndUserByExternalId,
  getEndUserById,
  listThreadParticipants,
  recordUsage,
  setCommentResolved,
  toWireComment,
  upsertEndUser,
  upsertRoom,
} from "../repos/index.js";
import { type WebhookDispatcher } from "../webhooks/dispatcher.js";

export interface CommentServiceDeps {
  db: Db;
  hub: RoomHub;
  webhooks: WebhookDispatcher;
}

export type ServiceResult<T> =
  { ok: true; value: T } | { ok: false; code: "invalid_thread" | "not_found"; message: string };

export function toWireNotification(notification: Notification): NotificationWire {
  return {
    id: notification.id,
    type: notification.type,
    payload: notification.payload as JsonValue,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Creates a comment and performs the full fan-out: realtime comment_created to
 * room members, notifications (persisted + pushed over WS) to other thread
 * participants, comment.created webhooks and usage metering. Shared by the
 * REST route and the realtime comment_create handler.
 */
export async function createCommentService(
  deps: CommentServiceDeps,
  input: {
    projectId: string;
    roomExternalId: string;
    authorExternalId: string;
    body: string;
    threadId?: string | null;
    anchor?: JsonValue | null;
    requestId?: string;
  },
): Promise<ServiceResult<Comment>> {
  const { db } = deps;

  // Rooms are created lazily — a comment may be the room's first event.
  const room = await upsertRoom(db, {
    projectId: input.projectId,
    externalId: input.roomExternalId,
  });

  const author =
    (await getEndUserByExternalId(db, input.projectId, input.authorExternalId)) ??
    (await upsertEndUser(db, { projectId: input.projectId, externalId: input.authorExternalId }));

  if (input.threadId) {
    const root = await getCommentById(db, input.threadId);
    if (!root || root.roomId !== room.id) {
      return {
        ok: false,
        code: "invalid_thread",
        message: "threadId does not belong to this room",
      };
    }
    if (root.threadId !== null) {
      return { ok: false, code: "invalid_thread", message: "threadId must point to a thread root" };
    }
  }

  const comment = await createComment(db, {
    roomId: room.id,
    endUserId: author.id,
    body: input.body,
    threadId: input.threadId ?? null,
    anchor: input.anchor ?? null,
  });
  const wire = toWireComment(comment, author.externalId);

  await deps.hub.publishCommentCreated(
    input.projectId,
    input.roomExternalId,
    wire,
    input.requestId,
  );

  // Notify other participants of the thread (persist + realtime push).
  if (comment.threadId) {
    const participants = await listThreadParticipants(db, comment.threadId);
    await Promise.all(
      participants
        .filter((participant) => participant.endUserId !== author.id)
        .map(async (participant) => {
          const notification = await createNotification(db, {
            endUserId: participant.endUserId,
            type: "comment.replied",
            payload: {
              roomExternalId: input.roomExternalId,
              threadId: comment.threadId,
              commentId: comment.id,
              from: author.externalId,
            },
          });
          await deps.hub.publishNotification(
            input.projectId,
            participant.externalId,
            toWireNotification(notification),
          );
        }),
    );
  }

  await deps.webhooks.enqueue(input.projectId, "comment.created", wire);
  await recordUsage(db, { projectId: input.projectId, kind: "message", quantity: 1 });

  return { ok: true, value: wire };
}

/** Resolves/unresolves a comment with realtime + webhook fan-out. */
export async function resolveCommentService(
  deps: CommentServiceDeps,
  input: {
    projectId: string;
    roomExternalId: string;
    commentId: string;
    resolved: boolean;
    /** Room row must already be verified to belong to the project by callers
     *  passing roomId; service re-checks comment membership. */
    roomId: string;
    requestId?: string;
  },
): Promise<ServiceResult<Comment>> {
  const { db } = deps;

  const existing = await getCommentById(db, input.commentId);
  if (!existing || existing.roomId !== input.roomId) {
    return { ok: false, code: "not_found", message: "comment not found" };
  }

  const updated = await setCommentResolved(db, existing.id, input.resolved);
  if (!updated) return { ok: false, code: "not_found", message: "comment not found" };

  const author = await getEndUserById(db, updated.endUserId);
  const wire = toWireComment(updated, author?.externalId ?? "");

  await deps.hub.publishCommentUpdated(
    input.projectId,
    input.roomExternalId,
    wire,
    input.requestId,
  );
  if (input.resolved) {
    await deps.webhooks.enqueue(input.projectId, "comment.resolved", wire);
  }
  return { ok: true, value: wire };
}
