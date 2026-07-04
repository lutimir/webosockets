#!/usr/bin/env node
// Preflight for new contributors: checks every local dependency the dev
// environment needs and says exactly how to fix what is missing.
//
//   node scripts/doctor.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function ok(label, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, fix) {
  failures += 1;
  console.log(`  ✗ ${label}`);
  console.log(`      fix: ${fix}`);
}

function version(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

function tcpReachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

console.log("SyncKit doctor\n");

// ─── Toolchain ───────────────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 22) ok("Node.js >= 22", `v${process.versions.node}`);
else
  fail(`Node.js >= 22 (found v${process.versions.node})`, "install Node 22 LTS (nvm install 22)");

const pnpmVersion = version("pnpm");
if (pnpmVersion) ok("pnpm", `v${pnpmVersion}`);
else fail("pnpm", "corepack enable && corepack prepare pnpm@latest --activate");

if (existsSync(join(root, "node_modules"))) ok("dependencies installed");
else fail("dependencies installed", "pnpm install (from synckit/)");

// ─── Services ────────────────────────────────────────────────────────────────
const databaseUrl = new URL(
  process.env.DATABASE_URL ?? "postgres://synckit:synckit@localhost:5432/synckit",
);
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

if (await tcpReachable(databaseUrl.hostname, Number(databaseUrl.port || 5432))) {
  ok("PostgreSQL reachable", `${databaseUrl.hostname}:${databaseUrl.port || 5432}`);
} else {
  fail(
    `PostgreSQL at ${databaseUrl.hostname}:${databaseUrl.port || 5432}`,
    "docker compose up -d postgres   (or: service postgresql start)",
  );
}

if (await tcpReachable(redisUrl.hostname, Number(redisUrl.port || 6379))) {
  ok("Redis reachable", `${redisUrl.hostname}:${redisUrl.port || 6379}`);
} else {
  fail(
    `Redis at ${redisUrl.hostname}:${redisUrl.port || 6379}`,
    "docker compose up -d redis   (or: service redis-server start)",
  );
}

// ─── Repo hygiene ────────────────────────────────────────────────────────────
const hooksPath = version("git", ["config", "core.hooksPath"]);
if (hooksPath === ".githooks" || hooksPath?.endsWith("/.githooks")) {
  ok("git hooks wired", hooksPath);
} else {
  fail("git hooks wired (.githooks)", "git config core.hooksPath synckit/.githooks");
}

console.log("");
if (failures > 0) {
  console.log(`${failures} problem(s) found.`);
  process.exit(1);
}
console.log("All checks passed — you are ready to develop.");
