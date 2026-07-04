# Contributing to SyncKit

## Getting started

```bash
git config core.hooksPath synckit/.githooks   # once, from the repo root
cd synckit
pnpm install
docker compose up -d          # Postgres 16 + Redis 7
pnpm db:migrate
node scripts/doctor.mjs       # verifies your environment end to end
pnpm dev                      # server :4000 + dashboard :3000
```

`scripts/doctor.mjs` checks Node ≥ 22, pnpm, installed deps, reachable
Postgres/Redis and the git-hooks wiring, and prints the exact fix for
anything missing. Run it first whenever something feels broken.

## Repository layout

| Path              | What lives there                                                                    |
| ----------------- | ----------------------------------------------------------------------------------- |
| `packages/core`   | Wire protocol (zod schemas), plans, shared types — no I/O                           |
| `packages/client` | Framework-agnostic browser SDK (≤ 15 kB gzip, enforced at build)                    |
| `packages/react`  | React hooks + themable components on top of the client                              |
| `apps/server`     | Fastify API + WS gateway + webhooks + billing                                       |
| `apps/dashboard`  | Next.js customer dashboard (BFF pattern — browser never calls `/internal` directly) |
| `load/`           | k6 scripts + zero-dependency load harness ([results](./load/RESULTS.md))            |

## Development workflow

1. Branch from `main`.
2. Make your change. Rules that keep the codebase honest:
   - **All SQL goes through `apps/server/src/repos/`** — no queries in routes
     or services.
   - **Protocol changes start in `packages/core`** — schemas are the single
     source of truth for both sides of the wire.
   - New behavior ships with a test at the same level as the behavior
     (protocol → protocol test, route → integration test against real
     Postgres/Redis; we do not mock the database).
3. Quality gates — CI runs exactly these, so run them locally first:

   ```bash
   pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test
   ```

4. If your change touches a **publishable package** (`core`, `client`,
   `react`), add a changeset — CI-released versions are cut from these:

   ```bash
   pnpm exec changeset        # pick bump level, describe the change
   ```

5. Open a PR. The pre-commit hook enforces formatting and refuses `.env`
   files; CodeQL and `pnpm audit` run in CI.

## API error format

Every non-2xx REST response uses one envelope — keep it that way:

```json
{ "error": { "code": "not_found", "message": "room not found" } }
```

- `code` is a stable, machine-readable snake_case identifier (`validation_error`,
  `unauthorized`, `insufficient_scope`, `not_found`, `rate_limited`,
  `payment_required`, `service_unavailable`, `internal_error`, …). Clients
  branch on `code`, never on `message`.
- `message` is human-readable and safe to show to developers; it must never
  contain secrets or internal hostnames.
- Transient failures additionally set `Retry-After` (seconds) — e.g. `503`
  when the database is unreachable, `429` on rate limits.
- WebSocket errors mirror the same idea: `{ "type": "error", "code", "message" }`
  plus close codes `4401` (bad token), `4403` (limit/entitlement), `4429`
  (rate limited).

## Commit style

Imperative subject line, ≤ 72 chars, body explains _why_ when it isn't
obvious. One logical change per commit.

## Reporting security issues

See [SECURITY.md](./SECURITY.md) — never open a public issue for a
vulnerability.
