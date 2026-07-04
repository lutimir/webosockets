import {
  type Comment,
  type JsonValue,
  type Notification,
  type PresenceEntry,
  type Status,
} from "@synckit/client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useClient, useRoomContext } from "./context.js";
import { throttle } from "./store.js";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Connection status of the client, live. */
export function useConnectionStatus(): Status {
  const client = useClient();
  const subscribe = useCallback((onChange: () => void) => client.on("status", onChange), [client]);
  return useSyncExternalStore(
    subscribe,
    () => client.status,
    () => client.status,
  );
}

const identity = (others: PresenceEntry[]) => others as never;

/**
 * Everyone else in the room. With a selector, components re-render only when
 * the selected value changes (compared with `isEqual`, default Object.is).
 */
export function useOthers<T = PresenceEntry[]>(
  selector: (others: PresenceEntry[]) => T = identity,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { room } = useRoomContext();
  const selectorRef = useLatest(selector);
  const isEqualRef = useLatest(isEqual);

  const store = useMemo(() => {
    let current = selectorRef.current(room.presence.get());
    return {
      subscribe: (onChange: () => void) =>
        room.presence.subscribe((others) => {
          const next = selectorRef.current(others);
          if (!isEqualRef.current(current, next)) {
            current = next;
            onChange();
          }
        }),
      getSnapshot: () => current,
    };
    // selector/isEqual are read through refs on purpose.
  }, [room]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** [myPresence, updateMyPresence] — like useState, synced to the room. */
export function useMyPresence(): [JsonValue | null, (data: JsonValue) => void] {
  const { room, myPresence } = useRoomContext();
  const value = useSyncExternalStore(myPresence.subscribe, myPresence.get, myPresence.get);
  const update = useCallback(
    (data: JsonValue) => {
      room.presence.update(data);
      myPresence.set(data);
    },
    [room, myPresence],
  );
  return [value, update];
}

/**
 * Presence updater throttled to one send per `throttleMs` (default 60 ms —
 * ~16 updates/s, comfortably under the server's rate limit). Does not
 * subscribe to presence, so the component never re-renders because of it.
 */
export function useUpdateMyPresence(throttleMs = 60): (data: JsonValue) => void {
  const { room, myPresence } = useRoomContext();
  return useMemo(
    () =>
      throttle((data: JsonValue) => {
        room.presence.update(data);
        myPresence.set(data);
      }, throttleMs),
    [room, myPresence, throttleMs],
  );
}

/** Returns a stable emitter for custom room events. */
export function useBroadcastEvent(): (event: string, payload: JsonValue) => void {
  const { room } = useRoomContext();
  return useCallback(
    (event: string, payload: JsonValue) => room.broadcast.emit(event, payload),
    [room],
  );
}

/** Subscribes to a custom room event for the component's lifetime. */
export function useEventListener(
  event: string,
  handler: (payload: JsonValue, from: string) => void,
): void {
  const { room } = useRoomContext();
  const handlerRef = useLatest(handler);
  useEffect(
    () => room.broadcast.on(event, (payload, from) => handlerRef.current(payload, from)),
    // handlerRef is stable.
    [room, event],
  );
}

export interface CommentView extends Comment {
  /** True while an optimistic create is awaiting server confirmation. */
  pending?: boolean;
}

export interface UseCommentsResult {
  comments: CommentView[];
  isLoading: boolean;
  error: string | undefined;
  create: (input: { body: string; threadId?: string; anchor?: JsonValue }) => Promise<void>;
  resolve: (commentId: string, resolved?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

function anchorMatches(comment: Comment, anchor: JsonValue | undefined): boolean {
  if (anchor === undefined) return true;
  return JSON.stringify(comment.anchor) === JSON.stringify(anchor);
}

/**
 * Live comment list of the room (optionally filtered by anchor) with
 * optimistic creates (rolled back on failure) and realtime updates.
 */
export function useComments(options: { anchor?: JsonValue } = {}): UseCommentsResult {
  const { room } = useRoomContext();
  const client = useClient();
  const [comments, setComments] = useState<CommentView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const anchorKey = options.anchor === undefined ? undefined : JSON.stringify(options.anchor);
  const anchorRef = useLatest(options.anchor);

  const upsert = useCallback((incoming: Comment) => {
    setComments((current) => {
      const existing = current.findIndex((comment) => comment.id === incoming.id);
      if (existing >= 0) {
        const next = [...current];
        next[existing] = incoming;
        return next;
      }
      return [...current, incoming];
    });
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const items: Comment[] = [];
      let cursor: string | undefined;
      do {
        const page = await room.comments.list({ limit: 100, ...(cursor ? { cursor } : {}) });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setComments(items.filter((comment) => anchorMatches(comment, anchorRef.current)));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
    // anchorRef is stable.
  }, [room]);

  useEffect(() => {
    // Load once connected; re-load after reconnects would go through resync.
    const load = () => void refresh();
    if (client.status === "connected") load();
    const unsubscribe = client.on("status", (status) => {
      if (status === "connected") load();
    });
    return unsubscribe;
  }, [client, refresh]);

  useEffect(() => {
    const offCreated = room.comments.on("created", (comment) => {
      if (anchorMatches(comment, anchorRef.current)) upsert(comment);
    });
    const offUpdated = room.comments.on("updated", (comment) => {
      if (anchorMatches(comment, anchorRef.current)) upsert(comment);
    });
    return () => {
      offCreated();
      offUpdated();
    };
    // anchorRef is stable.
  }, [room, upsert]);

  const create = useCallback(
    async (input: { body: string; threadId?: string; anchor?: JsonValue }) => {
      const anchor = input.anchor ?? anchorRef.current;
      const optimistic: CommentView = {
        id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        threadId: input.threadId ?? null,
        endUserId: client.endUserId ?? "me",
        body: input.body,
        anchor: anchor ?? null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        pending: true,
      };
      setComments((current) => [...current, optimistic]);
      try {
        const created = await room.comments.create({
          body: input.body,
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
          ...(anchor !== undefined && anchor !== null ? { anchor } : {}),
        });
        setComments((current) => {
          const withoutOptimistic = current.filter((comment) => comment.id !== optimistic.id);
          return withoutOptimistic.some((comment) => comment.id === created.id)
            ? withoutOptimistic
            : [...withoutOptimistic, created];
        });
      } catch (caught) {
        // Roll the optimistic comment back.
        setComments((current) => current.filter((comment) => comment.id !== optimistic.id));
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    // anchorRef is stable.
    [room, client],
  );

  const resolve = useCallback(
    async (commentId: string, resolved = true) => {
      const updated = await room.comments.resolve(commentId, resolved);
      upsert(updated);
    },
    [room, upsert],
  );

  // Re-load when the anchor filter changes.
  useEffect(() => {
    if (client.status === "connected") void refresh();
  }, [anchorKey]);

  return { comments, isLoading, error, create, resolve, refresh };
}

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  /** Marks notifications read locally; wire persistence up via your backend. */
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
}

/** Realtime notification inbox state for the current user. */
export function useNotifications(): UseNotificationsResult {
  const client = useClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(
    () =>
      client.notifications.subscribe((notification) => {
        setNotifications((current) =>
          current.some((existing) => existing.id === notification.id)
            ? current
            : [notification, ...current],
        );
      }),
    [client],
  );

  const markRead = useCallback((ids: string[]) => {
    const stamp = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        ids.includes(notification.id) && notification.readAt === null
          ? { ...notification, readAt: stamp }
          : notification,
      ),
    );
  }, []);

  const markAllRead = useCallback(() => {
    const stamp = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.readAt === null ? { ...notification, readAt: stamp } : notification,
      ),
    );
  }, []);

  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;
  return { notifications, unreadCount, markRead, markAllRead };
}
