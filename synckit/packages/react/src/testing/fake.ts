import {
  Emitter,
  type Comment,
  type JsonValue,
  type Notification,
  type PresenceEntry,
  type Room,
  type Status,
  type SyncKitClient,
} from "@synckit/client";

/**
 * Duck-typed stand-ins for SyncKitClient/Room used by unit tests and
 * Storybook. They implement exactly the surface the hooks consume and expose
 * imperative controls to simulate server activity.
 */
export function createFake(options: { comments?: Comment[]; failCreates?: boolean } = {}) {
  const othersEmitter = new Emitter<{ others: PresenceEntry[] }>();
  const broadcastEmitter = new Emitter<Record<string, { payload: JsonValue; from: string }>>();
  const commentEmitter = new Emitter<{ created: Comment; updated: Comment }>();
  const clientEmitter = new Emitter<{ status: Status; notification: Notification }>();

  let others: PresenceEntry[] = [];
  let myPresence: JsonValue | null = null;
  let commentStore: Comment[] = [...(options.comments ?? [])];
  let commentCounter = 0;
  let status: Status = "connected";

  const room = {
    externalId: "fake-room",
    presence: {
      get: () => others,
      getMy: () => myPresence,
      update: (data: JsonValue) => {
        myPresence = data;
      },
      subscribe: (handler: (entries: PresenceEntry[]) => void) => {
        handler(others);
        return othersEmitter.on("others", handler);
      },
    },
    broadcast: {
      emit: (event: string, payload: JsonValue) =>
        broadcastEmitter.emit(event, { payload, from: "me" }),
      on: (event: string, handler: (payload: JsonValue, from: string) => void) =>
        broadcastEmitter.on(event, (received) => handler(received.payload, received.from)),
    },
    comments: {
      list: () => Promise.resolve({ items: [...commentStore], nextCursor: undefined }),
      create: (input: { body: string; threadId?: string; anchor?: JsonValue }) => {
        if (options.failCreates) return Promise.reject(new Error("create failed"));
        const comment: Comment = {
          id: `c-${++commentCounter}`,
          threadId: input.threadId ?? null,
          endUserId: "me",
          body: input.body,
          anchor: input.anchor ?? null,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        };
        commentStore.push(comment);
        return Promise.resolve(comment);
      },
      resolve: (commentId: string, resolved = true) => {
        const existing = commentStore.find((comment) => comment.id === commentId);
        if (!existing) return Promise.reject(new Error("not found"));
        const updated: Comment = {
          ...existing,
          resolvedAt: resolved ? new Date().toISOString() : null,
        };
        commentStore = commentStore.map((comment) =>
          comment.id === commentId ? updated : comment,
        );
        return Promise.resolve(updated);
      },
      on: (event: "created" | "updated", handler: (comment: Comment) => void) =>
        commentEmitter.on(event, handler),
    },
    sendJoin: () => undefined,
    leave: () => Promise.resolve(),
    onResync: () => () => undefined,
    handleServerMessage: () => undefined,
  };

  const client = {
    get status() {
      return status;
    },
    endUserId: "me",
    connect: () => undefined,
    disconnect: () => undefined,
    joinRoom: () => room as unknown as Room,
    on: (event: "status" | "error", handler: (payload: never) => void) =>
      clientEmitter.on(event as "status", handler as (status: Status) => void),
    notifications: {
      subscribe: (handler: (notification: Notification) => void) =>
        clientEmitter.on("notification", handler),
    },
  };

  const controls = {
    setOthers(entries: PresenceEntry[]) {
      others = entries;
      othersEmitter.emit("others", entries);
    },
    pushBroadcast(event: string, payload: JsonValue, from: string) {
      broadcastEmitter.emit(event, { payload, from });
    },
    pushCommentCreated(comment: Comment) {
      commentStore.push(comment);
      commentEmitter.emit("created", comment);
    },
    pushNotification(notification: Notification) {
      clientEmitter.emit("notification", notification);
    },
    setStatus(next: Status) {
      status = next;
      clientEmitter.emit("status", next);
    },
    getMyPresence: () => myPresence,
    getComments: () => [...commentStore],
  };

  return {
    client: client as unknown as SyncKitClient,
    room: room as unknown as Room,
    controls,
  };
}

export function presenceEntry(
  endUserId: string,
  data: JsonValue = null,
  displayName: string | null = null,
): PresenceEntry {
  return { endUserId, displayName, avatarUrl: null, data };
}

export function fakeNotification(id: string, readAt: string | null = null): Notification {
  return {
    id,
    type: "comment.replied",
    payload: { roomExternalId: "fake-room" },
    readAt,
    createdAt: new Date().toISOString(),
  };
}
