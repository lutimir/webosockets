import {
  presenceEntrySchema,
  type Comment,
  type JsonValue,
  type Notification,
  type PresenceEntry,
  type ServerMessage,
} from "@synckit/core";
import { type FastifyBaseLogger } from "fastify";
import { type Redis } from "ioredis";

import { type Db } from "../db/client.js";
import { fanoutSeconds } from "../metrics.js";
import { upsertRoom } from "../repos/index.js";

import { type ConnectionManager, type ManagedConnection } from "./connection-manager.js";

interface RoomHubDeps {
  redis: Redis;
  /** Dedicated connection in subscriber mode (ioredis requirement). */
  subscriber: Redis;
  db: Db;
  manager: ConnectionManager;
  log: FastifyBaseLogger;
  presenceTtlSeconds: number;
}

interface PubSubEnvelope {
  sender: string;
  message: ServerMessage;
}

/**
 * Room membership and fan-out. Presence lives in Redis hashes (TTL-protected
 * against crashed instances); events flow through Redis pub/sub so every
 * server instance — including the publishing one — delivers from the same
 * stream, which keeps cross-instance ordering consistent. Sequence numbers
 * are per-room Redis counters, monotonic across instances.
 */
export class RoomHub {
  /** channel → local member connections */
  private readonly members = new Map<string, Set<ManagedConnection>>();

  constructor(private readonly deps: RoomHubDeps) {
    deps.subscriber.on("message", (channel: string, raw: string) => {
      this.deliverLocal(channel, raw);
    });
  }

  get roomCount(): number {
    return this.members.size;
  }

  private channel(projectId: string, roomExternalId: string): string {
    return `room:${projectId}:${roomExternalId}`;
  }

  private presenceKey(projectId: string, roomExternalId: string): string {
    return `presence:${projectId}:${roomExternalId}`;
  }

  private seqKey(projectId: string, roomExternalId: string): string {
    return `seq:${projectId}:${roomExternalId}`;
  }

  private nextSeq(projectId: string, roomExternalId: string): Promise<number> {
    return this.deps.redis.incr(this.seqKey(projectId, roomExternalId));
  }

  /** Current seq without consuming one (room_joined snapshots must not create
   *  gaps in the stream other members observe). */
  private async currentSeq(projectId: string, roomExternalId: string): Promise<number> {
    const value = await this.deps.redis.get(this.seqKey(projectId, roomExternalId));
    return value === null ? 0 : Number(value);
  }

  async join(
    connection: ManagedConnection,
    roomExternalId: string,
    initialPresence?: JsonValue,
  ): Promise<void> {
    const { projectId, endUserId } = connection.identity;
    const channel = this.channel(projectId, roomExternalId);

    // Subscribe before reading presence so no concurrent diff is missed.
    let local = this.members.get(channel);
    if (!local) {
      local = new Set();
      this.members.set(channel, local);
      await this.deps.subscriber.subscribe(channel);
    }
    local.add(connection);
    connection.joinedRooms.add(roomExternalId);

    await upsertRoom(this.deps.db, { projectId, externalId: roomExternalId });

    const entry: PresenceEntry = {
      endUserId,
      displayName: connection.identity.displayName,
      avatarUrl: connection.identity.avatarUrl,
      data: initialPresence ?? null,
    };
    const others = await this.readPresence(projectId, roomExternalId, endUserId);
    await this.writePresence(projectId, roomExternalId, entry);

    this.deps.manager.deliver(connection, {
      type: "room_joined",
      roomExternalId,
      seq: await this.currentSeq(projectId, roomExternalId),
      presence: others,
    });

    await this.publish(channel, connection.id, {
      type: "presence_diff",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      joined: [entry],
      left: [],
      updated: [],
    });
  }

  async updatePresence(
    connection: ManagedConnection,
    roomExternalId: string,
    data: JsonValue,
  ): Promise<boolean> {
    if (!connection.joinedRooms.has(roomExternalId)) return false;
    const { projectId, endUserId } = connection.identity;

    const entry: PresenceEntry = {
      endUserId,
      displayName: connection.identity.displayName,
      avatarUrl: connection.identity.avatarUrl,
      data,
    };
    await this.writePresence(projectId, roomExternalId, entry);
    await this.publish(this.channel(projectId, roomExternalId), connection.id, {
      type: "presence_diff",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      joined: [],
      left: [],
      updated: [entry],
    });
    return true;
  }

  async broadcast(
    connection: ManagedConnection,
    roomExternalId: string,
    event: string,
    payload: JsonValue,
  ): Promise<boolean> {
    if (!connection.joinedRooms.has(roomExternalId)) return false;
    const { projectId, endUserId } = connection.identity;
    await this.publish(this.channel(projectId, roomExternalId), connection.id, {
      type: "broadcast_received",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      event,
      payload,
      from: endUserId,
    });
    return true;
  }

  async leave(connection: ManagedConnection, roomExternalId: string): Promise<boolean> {
    if (!connection.joinedRooms.has(roomExternalId)) return false;
    const { projectId, endUserId } = connection.identity;
    const channel = this.channel(projectId, roomExternalId);

    connection.joinedRooms.delete(roomExternalId);
    const local = this.members.get(channel);
    local?.delete(connection);
    if (local && local.size === 0) {
      this.members.delete(channel);
      await this.deps.subscriber.unsubscribe(channel);
    }

    await this.deps.redis.hdel(this.presenceKey(projectId, roomExternalId), endUserId);
    await this.publish(channel, connection.id, {
      type: "presence_diff",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      joined: [],
      left: [endUserId],
      updated: [],
    });
    return true;
  }

  /** Presence snapshot of a room — used by the REST presence endpoint. */
  async getPresence(projectId: string, roomExternalId: string): Promise<PresenceEntry[]> {
    return this.readPresence(projectId, roomExternalId, "");
  }

  /**
   * Server-initiated event fan-out (e.g. a comment created via REST) to all
   * members of a room on every instance. The sender id "server" never matches
   * a connection id, so nobody is excluded from delivery.
   */
  async publishCommentCreated(
    projectId: string,
    roomExternalId: string,
    comment: Comment,
    requestId?: string,
  ): Promise<void> {
    await this.publish(this.channel(projectId, roomExternalId), "server", {
      type: "comment_created",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      comment,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  async publishCommentUpdated(
    projectId: string,
    roomExternalId: string,
    comment: Comment,
    requestId?: string,
  ): Promise<void> {
    await this.publish(this.channel(projectId, roomExternalId), "server", {
      type: "comment_updated",
      roomExternalId,
      seq: await this.nextSeq(projectId, roomExternalId),
      comment,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  // ─── Per-user channels (notification push) ─────────────────────────────────

  private userChannel(projectId: string, endUserExternalId: string): string {
    return `user:${projectId}:${endUserExternalId}`;
  }

  /** Subscribes a connection to its user's notification channel. */
  async subscribeUser(connection: ManagedConnection): Promise<void> {
    const channel = this.userChannel(connection.identity.projectId, connection.identity.endUserId);
    let local = this.members.get(channel);
    if (!local) {
      local = new Set();
      this.members.set(channel, local);
      await this.deps.subscriber.subscribe(channel);
    }
    local.add(connection);
  }

  async unsubscribeUser(connection: ManagedConnection): Promise<void> {
    const channel = this.userChannel(connection.identity.projectId, connection.identity.endUserId);
    const local = this.members.get(channel);
    local?.delete(connection);
    if (local && local.size === 0) {
      this.members.delete(channel);
      await this.deps.subscriber.unsubscribe(channel);
    }
  }

  /** Pushes a notification to every live connection of an end user. */
  async publishNotification(
    projectId: string,
    endUserExternalId: string,
    notification: Notification,
  ): Promise<void> {
    await this.publish(this.userChannel(projectId, endUserExternalId), "server", {
      type: "notification",
      notification,
    });
  }

  /** Called on disconnect: leaves every room the connection was in. */
  async leaveAll(connection: ManagedConnection): Promise<void> {
    for (const roomExternalId of [...connection.joinedRooms]) {
      await this.leave(connection, roomExternalId);
    }
  }

  private async readPresence(
    projectId: string,
    roomExternalId: string,
    excludeEndUserId: string,
  ): Promise<PresenceEntry[]> {
    const raw = await this.deps.redis.hgetall(this.presenceKey(projectId, roomExternalId));
    const entries: PresenceEntry[] = [];
    for (const [endUserId, value] of Object.entries(raw)) {
      if (endUserId === excludeEndUserId) continue;
      try {
        const parsed = presenceEntrySchema.safeParse(JSON.parse(value));
        if (parsed.success) entries.push(parsed.data);
      } catch {
        // Corrupt entry — skip it rather than break the whole room.
      }
    }
    return entries;
  }

  private async writePresence(
    projectId: string,
    roomExternalId: string,
    entry: PresenceEntry,
  ): Promise<void> {
    const key = this.presenceKey(projectId, roomExternalId);
    await this.deps.redis.hset(key, entry.endUserId, JSON.stringify(entry));
    await this.deps.redis.expire(key, this.deps.presenceTtlSeconds);
  }

  private async publish(
    channel: string,
    senderConnectionId: string,
    message: ServerMessage,
  ): Promise<void> {
    const envelope: PubSubEnvelope = { sender: senderConnectionId, message };
    await this.deps.redis.publish(channel, JSON.stringify(envelope));
  }

  /** Fan-out of a pub/sub message to local members (excluding the sender). */
  private deliverLocal(channel: string, raw: string): void {
    const local = this.members.get(channel);
    if (!local || local.size === 0) return;

    let envelope: PubSubEnvelope;
    try {
      envelope = JSON.parse(raw) as PubSubEnvelope;
    } catch (error) {
      this.deps.log.warn({ err: error, channel }, "dropping malformed pub/sub message");
      return;
    }

    const stopTimer = fanoutSeconds.startTimer();
    for (const connection of local) {
      if (connection.id === envelope.sender) continue;
      this.deps.manager.deliver(connection, envelope.message);
    }
    stopTimer();
  }
}
