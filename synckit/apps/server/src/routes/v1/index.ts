import { type FastifyInstance } from "fastify";

import { commentsRoutes } from "./comments.js";
import { notificationsRoutes } from "./notifications.js";
import { roomsRoutes } from "./rooms.js";
import { tokensRoutes } from "./tokens.js";

export function v1Routes(app: FastifyInstance): void {
  tokensRoutes(app);
  roomsRoutes(app);
  commentsRoutes(app);
  notificationsRoutes(app);

  // Machine-readable API description (source of the docs site later).
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
}
