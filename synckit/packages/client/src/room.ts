import {
  type ClientMessage,
  type Comment,
  type JsonValue,
  type PresenceEntry,
  type ServerMessage,
} from "@synckit/core";

import { Emitter, type Unsubscribe } from "./events.js";

/** Callbacks the client injects into each room. */
export interface RoomDeps {
  send: (message: ClientMessage, bufferable: boolean) => void;
  request: (message: ClientMessage & { requestId: string }) => Promise<ServerMessage>;
  getMyId: () => string | undefined;
  onLeft: (externalId: string) => void;
  generateRequestId: () => string;
}

export interface CommentPage {
  items: Comment[];
  nextCursor: string | undefined;
}

interface BroadcastEvent {
  payload: JsonValue;
  from: string;
}

export class Room {
  readonly externalId: string;

  private readonly deps: RoomDeps;
  private readonly initialPresence: JsonValue | null;
  private readonly others = new Map<string, PresenceEntry>();
  private myPresence: JsonValue | null;
  private lastSeq: number | null = null;
  /**
   * Own sent messages consume room seq numbers we never receive (the server
   * does not echo to the sender), so a bounded seq gap is normal. This counts
   * outstanding self-produced seqs; only gaps beyond it trigger a resync.
   */
  private outstandingOwnSeqs = 0;
  private resyncing = false;

  private readonly emitter = new Emitter<{ others: PresenceEntry[]; resync: undefined }>();
  private readonly broadcastEmitter = new Emitter<Record<string, BroadcastEvent>>();
  private readonly commentEmitter = new Emitter<{ created: Comment; updated: Comment }>();

  constructor(externalId: string, initialPresence: JsonValue | undefined, deps: RoomDeps) {
    this.externalId = externalId;
    this.initialPresence = initialPresence ?? null;
    this.myPresence = this.initialPresence;
    this.deps = deps;
  }

  // ─── Presence ───────────────────────────────────────────────────────────────

  readonly presence = {
    /** Everyone else currently in the room (never includes yourself). */
    get: (): PresenceEntry[] => [...this.others.values()],
    getMy: (): JsonValue | null => this.myPresence,
    update: (data: JsonValue): void => {
      this.myPresence = data;
      this.deps.send({ type: "presence_update", roomExternalId: this.externalId, data }, true);
      this.outstandingOwnSeqs += 1;
    },
    /** Calls back immediately with the current snapshot, then on every change. */
    subscribe: (handler: (others: PresenceEntry[]) => void): Unsubscribe => {
      handler(this.presence.get());
      return this.emitter.on("others", handler);
    },
  };

  // ─── Broadcast ──────────────────────────────────────────────────────────────

  readonly broadcast = {
    emit: (event: string, payload: JsonValue): void => {
      this.deps.send({ type: "broadcast", roomExternalId: this.externalId, event, payload }, true);
      this.outstandingOwnSeqs += 1;
    },
    on: (event: string, handler: (payload: JsonValue, from: string) => void): Unsubscribe =>
      this.broadcastEmitter.on(event, (received) => handler(received.payload, received.from)),
  };

  // ─── Comments ───────────────────────────────────────────────────────────────

  readonly comments = {
    list: async (options: { cursor?: string; limit?: number } = {}): Promise<CommentPage> => {
      const response = await this.deps.request({
        type: "comment_list",
        roomExternalId: this.externalId,
        requestId: this.deps.generateRequestId(),
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      });
      if (response.type !== "comment_list_result") throw new Error("unexpected response");
      return { items: response.items, nextCursor: response.nextCursor };
    },
    create: async (input: {
      body: string;
      threadId?: string;
      anchor?: JsonValue;
    }): Promise<Comment> => {
      const response = await this.deps.request({
        type: "comment_create",
        roomExternalId: this.externalId,
        body: input.body,
        requestId: this.deps.generateRequestId(),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
        ...(input.anchor !== undefined ? { anchor: input.anchor } : {}),
      });
      if (response.type !== "comment_created") throw new Error("unexpected response");
      return response.comment;
    },
    resolve: async (commentId: string, resolved = true): Promise<Comment> => {
      const response = await this.deps.request({
        type: "comment_resolve",
        roomExternalId: this.externalId,
        commentId,
        resolved,
        requestId: this.deps.generateRequestId(),
      });
      if (response.type !== "comment_updated") throw new Error("unexpected response");
      return response.comment;
    },
    on: (event: "created" | "updated", handler: (comment: Comment) => void): Unsubscribe =>
      this.commentEmitter.on(event, handler),
  };

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  leave(): Promise<void> {
    this.deps.send({ type: "leave_room", roomExternalId: this.externalId }, false);
    this.deps.onLeft(this.externalId);
    return Promise.resolve();
  }

  /** Sent on join and again on every reconnect (with the latest presence). */
  sendJoin(): void {
    const presence = this.myPresence;
    this.deps.send(
      {
        type: "join_room",
        roomExternalId: this.externalId,
        ...(presence !== null ? { initialPresence: presence } : {}),
      },
      false,
    );
  }

  onResync(handler: () => void): Unsubscribe {
    return this.emitter.on("resync", () => handler());
  }

  // ─── Server messages (called by the client) ─────────────────────────────────

  handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "room_joined": {
        this.lastSeq = message.seq;
        // Our own join produces a presence_diff we never receive.
        this.outstandingOwnSeqs = 1;
        this.resyncing = false;
        this.others.clear();
        const myId = this.deps.getMyId();
        for (const entry of message.presence) {
          if (entry.endUserId !== myId) this.others.set(entry.endUserId, entry);
        }
        this.emitOthers();
        return;
      }
      case "presence_diff": {
        if (!this.checkSeq(message.seq)) return;
        const myId = this.deps.getMyId();
        for (const entry of [...message.joined, ...message.updated]) {
          if (entry.endUserId !== myId) this.others.set(entry.endUserId, entry);
        }
        for (const endUserId of message.left) this.others.delete(endUserId);
        this.emitOthers();
        return;
      }
      case "broadcast_received": {
        if (!this.checkSeq(message.seq)) return;
        this.broadcastEmitter.emit(message.event, {
          payload: message.payload,
          from: message.from,
        });
        return;
      }
      case "comment_created": {
        if (!this.checkSeq(message.seq)) return;
        this.commentEmitter.emit("created", message.comment);
        return;
      }
      case "comment_updated": {
        if (!this.checkSeq(message.seq)) return;
        this.commentEmitter.emit("updated", message.comment);
        return;
      }
      default:
        return;
    }
  }

  private emitOthers(): void {
    this.emitter.emit("others", this.presence.get());
  }

  /**
   * Seq bookkeeping. Returns false when the message is stale. Triggers a
   * resync (full re-join snapshot) when more seqs were skipped than this
   * client itself produced — meaning messages were genuinely lost.
   */
  private checkSeq(seq: number): boolean {
    if (this.lastSeq === null) return true; // before first room_joined
    if (seq <= this.lastSeq) return false;

    const skipped = seq - this.lastSeq - 1;
    if (skipped > this.outstandingOwnSeqs) {
      this.lastSeq = seq;
      this.outstandingOwnSeqs = 0;
      this.requestResync();
      return false;
    }
    this.outstandingOwnSeqs -= skipped;
    this.lastSeq = seq;
    return true;
  }

  private requestResync(): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.emitter.emit("resync", undefined);
    this.sendJoin();
  }
}
