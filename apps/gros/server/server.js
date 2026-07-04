/* ===== Groš — API + statický server (čistý node:http, žiadne závislosti) =====
 * Spustenie:  node server/server.js   (z priečinka apps/gros)
 * Port:       GROS_PORT, default 8080
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

/* mini .env loader (server/.env, gitignorovaný) — nič neprepíše existujúce env */
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* .env je nepovinný */ }

const db = require("./db");
const stripe = require("./stripe");

const PORT = parseInt(process.env.GROS_PORT, 10) || 8080;
const STATIC_ROOT = path.resolve(__dirname, "..");
const SLUG_RE = /^[a-z0-9-]{2,30}$/;
const RESERVED_SLUGS = new Set(["api", "app", "admin", "www", "gros"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* ---------- helpers ---------- */
const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
};

const readRaw = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 64 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

const readBody = async (req) => {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("invalid json"); }
};

const getCookie = (req, name) => {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
};

const setSessionCookie = (res, token) => {
  res.setHeader("Set-Cookie",
    token
      ? `gros_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`
      : `gros_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
};

const cleanStr = (v, max) => String(v ?? "").trim().slice(0, max);

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const sessionSlug = db.getSession(getCookie(req, "gros_session"));

  // GET /api/health
  if (req.method === "GET" && url.pathname === "/api/health")
    return json(res, 200, { ok: true, service: "gros" });

  // GET /api/config — frontend podľa toho vie, či sú platby reálne
  if (req.method === "GET" && url.pathname === "/api/config")
    return json(res, 200, { payments: stripe.enabled() ? "stripe" : "demo" });

  // POST /api/stripe/webhook — checkout.session.completed → zapíš tip
  if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
    const raw = await readRaw(req);
    if (!stripe.verifyWebhook(raw, req.headers["stripe-signature"]))
      return json(res, 400, { error: "Neplatný podpis webhooku" });
    const event = JSON.parse(raw);
    if (event.type === "checkout.session.completed") {
      const parsed = stripe.tipFromSession(event.data.object);
      if (parsed && db.getCreator(parsed.slug)) db.addTip(parsed.slug, parsed.tip);
    }
    return json(res, 200, { received: true });
  }

  // POST /api/stripe/confirm — fallback po návrate zo success_url (bez webhookov)
  if (req.method === "POST" && url.pathname === "/api/stripe/confirm") {
    if (!stripe.enabled()) return json(res, 400, { error: "Stripe nie je nakonfigurovaný" });
    const b = await readBody(req);
    const id = cleanStr(b.session_id, 200);
    if (!id) return json(res, 400, { error: "Chýba session_id" });
    const session = await stripe.getCheckoutSession(id);
    if (session.payment_status !== "paid")
      return json(res, 402, { error: "Platba zatiaľ neprebehla" });
    const parsed = stripe.tipFromSession(session);
    if (!parsed || !db.getCreator(parsed.slug))
      return json(res, 400, { error: "Neznáma platba" });
    db.addTip(parsed.slug, parsed.tip); // idempotentné — webhook mohol predbehnúť
    return json(res, 200, { ok: true, slug: parsed.slug, amount: parsed.tip.amount });
  }

  // GET /api/me
  if (req.method === "GET" && url.pathname === "/api/me")
    return json(res, 200, { slug: sessionSlug });

  // POST /api/register
  if (req.method === "POST" && url.pathname === "/api/register") {
    const b = await readBody(req);
    const slug = cleanStr(b.slug, 30).toLowerCase();
    const name = cleanStr(b.name, 40);
    const password = String(b.password ?? "");
    if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug))
      return json(res, 400, { error: "Neplatná adresa stránky" });
    if (!name) return json(res, 400, { error: "Chýba meno" });
    if (password.length < 6) return json(res, 400, { error: "Heslo musí mať aspoň 6 znakov" });
    if (db.getCreator(slug)) return json(res, 409, { error: "Táto adresa je už obsadená" });

    const target = Number(b.goal?.target);
    db.createCreator({
      slug, name, password,
      emoji: cleanStr(b.emoji, 8) || "🎨",
      tagline: cleanStr(b.tagline, 200) || "Podpor moju tvorbu grošom!",
      goal: b.goal?.title && target >= 10 && target <= 100000
        ? { title: cleanStr(b.goal.title, 60), target }
        : null,
    });
    setSessionCookie(res, db.createSession(slug));
    return json(res, 201, { slug });
  }

  // POST /api/login
  if (req.method === "POST" && url.pathname === "/api/login") {
    const b = await readBody(req);
    const slug = cleanStr(b.slug, 30).toLowerCase();
    if (!db.checkLogin(slug, String(b.password ?? "")))
      return json(res, 401, { error: "Nesprávna adresa alebo heslo" });
    setSessionCookie(res, db.createSession(slug));
    return json(res, 200, { slug });
  }

  // POST /api/logout
  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = getCookie(req, "gros_session");
    if (token) db.deleteSession(token);
    setSessionCookie(res, null);
    return json(res, 200, { ok: true });
  }

  // /api/creators/:slug[/tips]
  if (seg[1] === "creators" && seg[2]) {
    const slug = seg[2].toLowerCase();
    if (!SLUG_RE.test(slug)) return json(res, 400, { error: "Neplatný slug" });
    const creator = db.getCreator(slug);
    if (!creator) return json(res, 404, { error: "Tvorca neexistuje" });

    // GET /api/creators/:slug
    if (req.method === "GET" && seg.length === 3)
      return json(res, 200, creator);

    // POST /api/creators/:slug/tips — demo platba (bez Stripe)
    if (req.method === "POST" && seg[3] === "tips") {
      const b = await readBody(req);
      const amount = Math.round(Number(b.amount) * 100) / 100;
      if (!(amount >= 0.5 && amount <= 10000))
        return json(res, 400, { error: "Suma musí byť 0,50 – 10 000 €" });
      db.addTip(slug, {
        name: cleanStr(b.name, 40) || "Anonym",
        amount,
        msg: cleanStr(b.msg, 240),
        monthly: !!b.monthly,
      });
      return json(res, 201, db.getCreator(slug));
    }

    // POST /api/creators/:slug/checkout — reálna platba cez Stripe Checkout
    if (req.method === "POST" && seg[3] === "checkout") {
      if (!stripe.enabled()) return json(res, 200, { demo: true });
      const b = await readBody(req);
      const amount = Math.round(Number(b.amount) * 100) / 100;
      if (!(amount >= 0.5 && amount <= 10000))
        return json(res, 400, { error: "Suma musí byť 0,50 – 10 000 €" });
      const session = await stripe.createCheckoutSession({
        creator,
        tip: {
          amount,
          name: cleanStr(b.name, 40) || "Anonym",
          msg: cleanStr(b.msg, 240),
          monthly: !!b.monthly,
        },
        origin: `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:" + PORT}`,
      });
      return json(res, 200, { url: session.url });
    }
  }

  return json(res, 404, { error: "Not found" });
}

/* ---------- static ---------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.join(STATIC_ROOT, rel);
  if (!file.startsWith(STATIC_ROOT + path.sep) || rel.includes("\0"))
    return json(res, 400, { error: "Bad path" });

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — skús /index.html alebo /app.html");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------- server ---------- */
db.seedDemo();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET") serveStatic(req, res, url);
    else json(res, 405, { error: "Method not allowed" });
  } catch (e) {
    json(res, 400, { error: e.message || "Bad request" });
  }
});

server.listen(PORT, () => {
  console.log(`🪙 Groš beží na http://localhost:${PORT}`);
  console.log(`   platby:   ${stripe.enabled() ? "Stripe ✅" : "demo režim (nastav STRIPE_SECRET_KEY v server/.env)"}`);
  console.log(`   landing:  http://localhost:${PORT}/`);
  console.log(`   appka:    http://localhost:${PORT}/app.html`);
  console.log(`   demo:     http://localhost:${PORT}/app.html#c/demo`);
});
