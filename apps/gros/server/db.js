/* ===== Groš — SQLite vrstva (node:sqlite, žiadne závislosti) ===== */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const path = require("node:path");

const DB_PATH = process.env.GROS_DB || path.join(__dirname, "gros.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS creators (
    slug        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL DEFAULT '🎨',
    tagline     TEXT NOT NULL DEFAULT '',
    goal_title  TEXT,
    goal_target REAL,
    pass_hash   TEXT NOT NULL,
    salt        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tips (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    slug    TEXT NOT NULL REFERENCES creators(slug),
    name    TEXT NOT NULL DEFAULT 'Anonym',
    amount  REAL NOT NULL,
    msg     TEXT NOT NULL DEFAULT '',
    monthly INTEGER NOT NULL DEFAULT 0,
    ts      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tips_slug ON tips(slug, ts DESC);
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    slug       TEXT NOT NULL REFERENCES creators(slug),
    created_at INTEGER NOT NULL
  );
`);

/* ---------- heslá ---------- */
const hashPassword = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString("hex");

const verifyPassword = (password, salt, hash) => {
  const candidate = Buffer.from(hashPassword(password, salt), "hex");
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
};

/* ---------- creators ---------- */
function createCreator({ slug, name, emoji, tagline, goal, password }) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO creators (slug, name, emoji, tagline, goal_title, goal_target, pass_hash, salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(slug, name, emoji, tagline, goal?.title ?? null, goal?.target ?? null,
        hashPassword(password, salt), salt, Date.now());
}

function getCreator(slug) {
  const row = db.prepare(`SELECT * FROM creators WHERE slug = ?`).get(slug);
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    tagline: row.tagline,
    goal: row.goal_title ? { title: row.goal_title, target: row.goal_target } : null,
    tips: db.prepare(
      `SELECT name, amount, msg, monthly, ts FROM tips WHERE slug = ? ORDER BY ts DESC LIMIT 200`
    ).all(slug).map((t) => ({ ...t, monthly: !!t.monthly })),
  };
}

function checkLogin(slug, password) {
  const row = db.prepare(`SELECT salt, pass_hash FROM creators WHERE slug = ?`).get(slug);
  return !!row && verifyPassword(password, row.salt, row.pass_hash);
}

/* ---------- tips ---------- */
function addTip(slug, { name, amount, msg, monthly }) {
  db.prepare(
    `INSERT INTO tips (slug, name, amount, msg, monthly, ts) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, name, amount, msg, monthly ? 1 : 0, Date.now());
}

/* ---------- sessions ---------- */
function createSession(slug) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO sessions (token, slug, created_at) VALUES (?, ?, ?)`)
    .run(token, slug, Date.now());
  return token;
}

const getSession = (token) =>
  token ? db.prepare(`SELECT slug FROM sessions WHERE token = ?`).get(token)?.slug ?? null : null;

const deleteSession = (token) =>
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);

/* ---------- demo seed ---------- */
function seedDemo() {
  if (getCreator("demo")) return;
  createCreator({
    slug: "demo",
    name: "Miško Pixel",
    emoji: "🎮",
    tagline: "Robím indie webové hry a návody, ako si spraviť vlastnú. Každý groš ide na kávu a serverovňu.",
    goal: { title: "Nový herný server", target: 300 },
    password: crypto.randomBytes(12).toString("hex"), // demo účet bez prihlásenia
  });
  const day = 86400000;
  [
    { name: "Zuzka", amount: 5, msg: "Curling hra je super, hrali sme ju celý večer! 🥌", monthly: 0, ts: Date.now() - day * 2 },
    { name: "Anonym", amount: 15, msg: "Len tak ďalej 💪", monthly: 0, ts: Date.now() - day * 5 },
    { name: "Peter K.", amount: 3, msg: "", monthly: 1, ts: Date.now() - day * 9 },
    { name: "Lucia", amount: 10, msg: "Za návod na websockety — konečne to chápem!", monthly: 0, ts: Date.now() - day * 14 },
  ].forEach((t) =>
    db.prepare(`INSERT INTO tips (slug, name, amount, msg, monthly, ts) VALUES ('demo', ?, ?, ?, ?, ?)`)
      .run(t.name, t.amount, t.msg, t.monthly, t.ts)
  );
}

module.exports = {
  createCreator, getCreator, checkLogin,
  addTip,
  createSession, getSession, deleteSession,
  seedDemo,
};
