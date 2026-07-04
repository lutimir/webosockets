# Security

## Reporting a vulnerability

Email **security@synckit.dev** (placeholder — replace with the real inbox
before going live). Please include reproduction steps and affected versions.
We aim to acknowledge within 48 hours and to ship a fix for confirmed
critical issues within 7 days. Do not open public issues for security
reports.

## Threat model in one paragraph

SyncKit terminates untrusted traffic in three places: the public REST API
(customer backends, `sk_*` keys), the WebSocket gateway (end users' browsers,
short-lived JWTs) and the dashboard (humans, session cookies). Everything
else — Postgres, Redis, the `/internal` API — lives on a private network and
must never be reachable from outside. Customer-supplied data (comments,
presence payloads, webhook URLs) is treated as hostile everywhere.

## Controls checklist (OWASP-aligned)

| Risk                         | Control                                                                                                                                                                                                                       | Where                                                       | Verified by                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Broken access control / IDOR | Every dashboard mutation re-checks the full ownership chain (session → org member → project → resource); REST scopes resources by the API key's project                                                                       | `routes/internal/index.ts`, `plugins/api-auth.ts`           | integration tests exercise cross-tenant 403/404s |
| Broken authentication        | API keys stored as sha256, located by prefix, compared timing-safe; passwords scrypt (N=2¹⁷); sessions are random 256-bit tokens stored hashed, 7-day TTL                                                                     | `repos/api-keys.ts`, `lib/password.ts`, `repos/sessions.ts` | `app.test.ts`, dashboard e2e                     |
| JWT attacks                  | HS256 pinned on verify (no algorithm confusion), `exp` enforced, zod-validated claims                                                                                                                                         | `lib/tokens.ts`                                             | unit + WS gateway tests (4401 close)             |
| Injection (SQLi)             | All queries go through Drizzle's parameterized builder; no string-built SQL outside the repository layer                                                                                                                      | `repos/**`                                                  | code review rule + typed queries                 |
| Input validation             | zod schemas on every REST body/query/param and every WS message; payload size caps (64 KB WS frames, bounded broadcast JSON)                                                                                                  | `packages/core/protocol.ts`, route schemas                  | protocol tests (invalid input → typed error)     |
| XSS                          | React text rendering only — no `dangerouslySetInnerHTML` anywhere; comment bodies are stored verbatim and escaped at render                                                                                                   | `packages/react/src/components/**`                          | grep-gate + component tests                      |
| SSRF via webhooks            | `checkWebhookUrl`: http(s) only, no credentials, blocks loopback/private/link-local/CGNAT/metadata IPv4+IPv6 (incl. v4-mapped hex form), DNS-resolves hostnames; re-checked **before every delivery** to defeat DNS rebinding | `webhooks/ssrf.ts`, `webhooks/dispatcher.ts`                | `ssrf.test.ts` (8 cases)                         |
| Webhook authenticity         | HMAC-SHA256 signature `t=…,v1=…` with 5-minute replay tolerance; per-endpoint secrets                                                                                                                                         | `webhooks/signature.ts`                                     | webhook tests                                    |
| Rate limiting / DoS          | REST: per-key limiter (429). WS: token bucket per connection (4429), per-user and per-project connection caps, heartbeat eviction, backpressure (slow-consumer drop at 1 MB, close 1013 at 5 MB)                              | `app.ts`, `realtime/connection-manager.ts`                  | realtime + churn tests                           |
| Secrets in logs              | `authorization` header and `?token=` query redacted in the logger; plaintext API keys shown exactly once at creation                                                                                                          | `app.ts`                                                    | log serializer test                              |
| Security headers / CORS      | helmet defaults; CORS locked to the dashboard origin                                                                                                                                                                          | `app.ts`                                                    | app tests                                        |
| Multi-tenant realtime        | Room channels are namespaced `room:{projectId}:{roomExternalId}`; a token from project A can never subscribe into project B                                                                                                   | `realtime/room-hub.ts`                                      | realtime isolation tests                         |
| Availability                 | DB outage → `503` + `Retry-After` (not 500), WS plane keeps running, automatic recovery; Redis outage → connections survive, fan-out resumes on reconnect                                                                     | `app.ts`, `chaos/chaos.test.ts`                             | chaos suite                                      |
| Vulnerable dependencies      | `pnpm audit --prod`: **0 known vulnerabilities** (postcss transitively pinned ≥ 8.5.10 via pnpm override); Dependabot weekly + CodeQL on every PR                                                                             | `package.json`, `.github/`                                  | CI                                               |

Known accepted risk: `pnpm audit` (dev deps) reports moderate advisories in
`esbuild`/`vite` dev servers via `tsup`/`vitest`. These affect only local
dev-server usage, never production artifacts; tracked until upstream tools
bump.

## Operational notes

- `JWT_SECRET` and `INTERNAL_API_SECRET` have obvious `dev-only-*` defaults —
  deployments **must** override them; rotate by dual-reading during rollout.
- `WEBHOOKS_ALLOW_PRIVATE=true` disables the SSRF guard. It exists for local
  development and the test suite; never set it in production (the flag is
  also implied outside `NODE_ENV=production`).
- `/internal/*` requires the `x-internal-secret` header and is meant to be
  network-isolated as defense in depth — do not expose it through the public
  load balancer.
