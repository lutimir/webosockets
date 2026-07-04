// Zero-dependency production server for the demo: serves the Vite build from
// dist/ and mints client tokens at /api/token (same contract as the Vite
// middleware in vite.config.ts). The API key stays server-side.
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 5173);
const SERVER_URL = process.env.SYNCKIT_SERVER_URL ?? "http://localhost:4000";
const API_KEY = process.env.SYNCKIT_API_KEY ?? "";
const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

async function mintToken(url, res) {
  const user = url.searchParams.get("user") ?? "guest";
  const name = url.searchParams.get("name") ?? user;
  res.setHeader("content-type", "application/json");
  if (!API_KEY) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "SYNCKIT_API_KEY is not set" }));
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://demo.local");
  if (url.pathname === "/api/token") {
    void mintToken(url, res);
    return;
  }
  if (url.pathname === "/healthz") {
    res.end("ok");
    return;
  }
  // Static files with an index.html fallback (SPA).
  const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, safePath);
  if (!existsSync(file) || safePath === "/") file = join(DIST, "index.html");
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  createReadStream(file)
    .on("error", () => {
      res.statusCode = 404;
      res.end("not found");
    })
    .pipe(res);
});

server.listen(PORT, () => {
  console.log(`demo listening on :${PORT} (SyncKit server: ${SERVER_URL})`);
});
