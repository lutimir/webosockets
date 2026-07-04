import { type IncomingMessage, type ServerResponse } from "node:http";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const SERVER_URL = process.env.SYNCKIT_SERVER_URL ?? "http://localhost:4000";
const API_KEY = process.env.SYNCKIT_API_KEY ?? "";

/**
 * Token-minting endpoint for the demo: the browser calls GET /api/token and
 * this (server-side) middleware exchanges the secret API key for a client
 * JWT via POST /v1/tokens. The API key never reaches the browser — exactly
 * the shape customers deploy in their own backend.
 */
async function mintToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://demo.local");
  const user = url.searchParams.get("user") ?? "guest";
  const name = url.searchParams.get("name") ?? user;
  res.setHeader("content-type", "application/json");
  if (!API_KEY) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "SYNCKIT_API_KEY is not set for the demo server" }));
    return;
  }
  try {
    const response = await fetch(`${SERVER_URL}/v1/tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ externalUserId: user, displayName: name }),
    });
    res.statusCode = response.status;
    res.end(await response.text());
  } catch (error) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(error) }));
  }
}

function tokenEndpoint(): Plugin {
  const attach = (middlewares: {
    use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void;
  }) => {
    middlewares.use("/api/token", (req, res) => void mintToken(req, res));
  };
  return {
    name: "synckit-demo-token-endpoint",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), tokenEndpoint()],
  define: {
    // WS endpoint the browser connects to (defaults to same host, port 4000).
    __SYNCKIT_WS_URL__: JSON.stringify(process.env.SYNCKIT_WS_URL ?? ""),
  },
});
