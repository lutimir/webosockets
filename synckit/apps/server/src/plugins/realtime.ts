import { CLOSE_CODES, parseClientMessage, type ClientMessage } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { type WebSocket } from "ws";

import { verifyClientToken } from "../lib/tokens.js";
import { type ManagedConnection } from "../realtime/connection-manager.js";
import { recordUsage } from "../repos/index.js";

const RATE_VIOLATIONS_BEFORE_CLOSE = 5;

/**
 * Realtime gateway: authenticates the client JWT from `?token=`, then routes
 * protocol messages to the RoomHub. All per-connection message handling is
 * serialized on a promise chain so joins always complete before updates.
 */
export function realtimeRoutes(app: FastifyInstance): void {
  const { manager, hub } = app.realtime;

  async function handleMessage(
    connection: ManagedConnection,
    raw: Buffer,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      manager.deliver(connection, {
        type: "error",
        code: "invalid_message",
        message: "binary frames are not supported",
      });
      return;
    }

    if (!connection.bucket.tryConsume()) {
      connection.rateViolations += 1;
      if (connection.rateViolations >= RATE_VIOLATIONS_BEFORE_CLOSE) {
        connection.socket.close(CLOSE_CODES.RATE_LIMITED, "rate limit exceeded repeatedly");
        return;
      }
      manager.deliver(connection, {
        type: "error",
        code: "rate_limited",
        message: "too many messages, slow down",
      });
      return;
    }

    const parsed = parseClientMessage(raw.toString("utf8"));
    if (!parsed.ok) {
      manager.deliver(connection, {
        type: "error",
        code: "invalid_message",
        message: parsed.error,
      });
      return;
    }

    await routeMessage(connection, parsed.message);
  }

  async function routeMessage(
    connection: ManagedConnection,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case "ping":
        manager.deliver(connection, { type: "pong", ts: Date.now() });
        return;
      case "join_room":
        await hub.join(connection, message.roomExternalId, message.initialPresence);
        return;
      case "leave_room":
        if (!(await hub.leave(connection, message.roomExternalId))) {
          notInRoom(connection, message.roomExternalId);
        }
        return;
      case "presence_update":
        if (!(await hub.updatePresence(connection, message.roomExternalId, message.data))) {
          notInRoom(connection, message.roomExternalId);
        }
        return;
      case "broadcast":
        if (
          !(await hub.broadcast(connection, message.roomExternalId, message.event, message.payload))
        ) {
          notInRoom(connection, message.roomExternalId);
        }
        return;
      case "comment_create":
        manager.deliver(connection, {
          type: "error",
          code: "internal_error",
          message: "comment_create arrives with the REST API in a later milestone",
        });
        return;
    }
  }

  function notInRoom(connection: ManagedConnection, roomExternalId: string): void {
    manager.deliver(connection, {
      type: "error",
      code: "not_in_room",
      message: `join room "${roomExternalId}" first`,
    });
  }

  app.get("/realtime", { websocket: true }, (socket: WebSocket, request) => {
    // Buffer messages that arrive while the token is being verified.
    const pending: [Buffer, boolean][] = [];
    let connection: ManagedConnection | undefined;
    let ready = false;
    let chain = Promise.resolve();

    const enqueue = (raw: Buffer, isBinary: boolean) => {
      chain = chain
        .then(() => (connection ? handleMessage(connection, raw, isBinary) : undefined))
        .catch((error: unknown) => {
          request.log.error({ err: error }, "error handling realtime message");
          if (connection) {
            manager.deliver(connection, {
              type: "error",
              code: "internal_error",
              message: "internal error",
            });
          }
        });
    };

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (ready) enqueue(raw, isBinary);
      else pending.push([raw, isBinary]);
    });

    const cleanup = async () => {
      if (!connection) return;
      const current = connection;
      connection = undefined;
      try {
        await hub.leaveAll(current);
        manager.unregister(current);

        const minutes = Math.max(1, Math.ceil((Date.now() - current.connectedAt) / 60_000));
        await recordUsage(app.db, {
          projectId: current.identity.projectId,
          kind: "connection_minutes",
          quantity: minutes,
        });
      } catch (error) {
        // Redis/DB may already be closing during shutdown — never let the
        // cleanup chain produce an unhandled rejection, and never leak the
        // connection slot.
        request.log.warn({ err: error }, "error during realtime connection cleanup");
        manager.unregister(current);
      }
    };

    socket.on("close", () => {
      chain = chain.then(cleanup);
    });

    void (async () => {
      const { token } = request.query as { token?: string };
      const identity = token ? await verifyClientToken(app.env.JWT_SECRET, token) : undefined;
      if (!identity) {
        socket.close(CLOSE_CODES.UNAUTHORIZED, "missing or invalid token");
        return;
      }

      const result = manager.register(socket, identity);
      if (!result.ok) {
        socket.close(CLOSE_CODES.LIMIT_EXCEEDED, result.reason);
        return;
      }

      connection = result.connection;
      request.log.info(
        { connectionId: connection.id, endUserId: identity.endUserId },
        "realtime connection established",
      );
      ready = true;
      for (const [raw, isBinary] of pending) enqueue(raw, isBinary);
      pending.length = 0;

      // The socket may have closed while the token was being verified — its
      // close event then ran before `connection` existed, so clean up now.
      if (socket.readyState === socket.CLOSING || socket.readyState === socket.CLOSED) {
        chain = chain.then(cleanup);
      }
    })();
  });
}
