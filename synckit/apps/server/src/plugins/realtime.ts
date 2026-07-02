import { parseClientMessage, type ServerMessage } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { type WebSocket } from "ws";

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Realtime gateway. This milestone only establishes the connection lifecycle
 * and the ping/pong contract; rooms, presence and auth land in later prompts.
 */
export function realtimeRoutes(app: FastifyInstance): void {
  app.get("/realtime", { websocket: true }, (socket, request) => {
    request.log.info("realtime connection opened");

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        send(socket, {
          type: "error",
          code: "invalid_message",
          message: "binary frames are not supported",
        });
        return;
      }

      const parsed = parseClientMessage(raw.toString("utf8"));
      if (!parsed.ok) {
        send(socket, { type: "error", code: "invalid_message", message: parsed.error });
        return;
      }

      switch (parsed.message.type) {
        case "ping":
          send(socket, { type: "pong", ts: Date.now() });
          break;
        default:
          send(socket, {
            type: "error",
            code: "internal_error",
            message: `"${parsed.message.type}" is not supported yet`,
          });
      }
    });

    socket.on("close", () => {
      request.log.info("realtime connection closed");
    });
  });
}
