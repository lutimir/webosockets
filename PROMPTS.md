# SyncKit — Master plán: 10 promptov na produkt predateľný za 1M+ €

## Čo staviame a prečo to má hodnotu

**SyncKit** — embeddovateľná real-time collaboration infraštruktúra (B2B SaaS + SDK).
Iné aplikácie si cez náš SDK pridajú do svojho produktu za pár hodín:

- **Presence** — kto je online, live kurzory, avatary
- **Komentáre** — vláknové komentáre ukotvené na ľubovoľný element/objekt v ich appke
- **Notifikácie** — in-app inbox + webhooky
- **Live state sync** — zdieľaný stav miestnosti (CRDT-lite)

**Prečo je to predateľné za 1M+ €:** presne tento typ firiem sa kupuje — Cord (acquired),
Liveblocks (Series A $5M+), Ably, Pusher (acquired by MessageBird). Kupujúcim nie je
koncový používateľ, ale *iná appka* (SaaS produkt), ktorá nechce 12 mesiacov stavať
realtime infraštruktúru. Hodnota = SDK + škálovateľný WS server + dashboard + billing
+ dokumentácia = hotová akvizičná cieľovka alebo produkt s ARR.

**Tech stack (finálny, nemeniť medzi promptami):**

| Vrstva | Technológia |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript strict everywhere |
| Realtime server | Node.js 22, Fastify + `ws`, Redis pub/sub (horizontálne škálovanie) |
| REST API | Fastify (rovnaký service ako WS, oddelené pluginy) |
| DB | PostgreSQL 16 + Drizzle ORM |
| Dashboard | Next.js 15 (App Router), Tailwind CSS, shadcn/ui |
| SDK | `@synckit/client` (vanilla TS), `@synckit/react` (hooks + komponenty) |
| Auth | API keys (server-to-server) + krátkodobé JWT pre end-userov klienta |
| Billing | Stripe (subscriptions + metered usage) |
| Testy | Vitest (unit/integration), Playwright (e2e), k6 (load) |
| Infra | Docker Compose (dev), Dockerfile (prod), GitHub Actions CI |

**Štruktúra monorepa (vznikne v Prompte 1, všetky ďalšie prompty ju dodržiavajú):**

```
synckit/
├── apps/
│   ├── server/          # Fastify: WS gateway + REST API
│   ├── dashboard/       # Next.js admin/customer dashboard
│   └── demo/            # Demo appka používajúca SDK (predajný nástroj!)
├── packages/
│   ├── core/            # Zdieľané typy, protokol, validácia (zod)
│   ├── client/          # @synckit/client — vanilla SDK
│   ├── react/           # @synckit/react — React SDK
│   └── config/          # zdieľané tsconfig/eslint
├── docker-compose.yml
├── turbo.json
└── PROMPTS.md
```

**Pravidlá pre všetky prompty:**
1. Každý prompt končí funkčným, otestovaným stavom — `pnpm build && pnpm test` prechádza.
2. Žiadne `any`, žiadne `@ts-ignore`. TypeScript strict.
3. Každý prompt = samostatný commit (alebo séria commitov) s popisnou správou.
4. Nič sa nemocká „na oko" — všetko reálne beží proti Postgres/Redis z docker-compose.

---

## PROMPT 1 — Založenie monorepa, tooling, CI, dev prostredie

> Vytvor v koreňovom adresári monorepo `synckit/` presne podľa štruktúry v PROMPTS.md.
>
> **Tooling:**
> - pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) + Turborepo
>   (`turbo.json` s pipeline `build`, `test`, `lint`, `typecheck`; správne `dependsOn`).
> - Root `package.json` so skriptami: `dev`, `build`, `test`, `lint`, `typecheck`, `db:migrate`, `db:seed`.
> - `packages/config`: zdieľaný `tsconfig.base.json` (strict: true, noUncheckedIndexedAccess: true,
>   module: NodeNext pre server balíky, bundler pre web) a zdieľaný ESLint flat config
>   (typescript-eslint, import order, no-floating-promises ako error). Prettier s jednou root konfiguráciou.
> - Vitest nakonfigurovaný na root úrovni s projects per-package.
>
> **Packages — skeleton s reálnym obsahom:**
> - `packages/core`: exportni prvú verziu WS protokolu — zod schémy pre obálku správy
>   `{ type, roomId, seq, ts, payload }` a union typov `client→server` (join_room, leave_room,
>   presence_update, comment_create, …) a `server→client` (room_state, presence_diff, comment_created,
>   error, pong). Každá schéma má test.
> - `apps/server`: Fastify server s `/healthz` (kontroluje Postgres + Redis konektivitu) a prázdnym
>   WS endpointom `/v1/realtime` ktorý zatiaľ len akceptuje spojenie a odpovedá na `ping` → `pong`.
>   Graceful shutdown (SIGTERM: prestať prijímať, dovrieť WS, flush).
> - `apps/dashboard`: čistý Next.js 15 + Tailwind + shadcn/ui init, jedna stránka `/` s logom a "SyncKit".
> - `apps/demo`: Vite + React skeleton, zatiaľ placeholder.
>
> **Dev prostredie:**
> - `docker-compose.yml`: postgres:16 (volume, healthcheck), redis:7 (healthcheck). `.env.example`
>   so VŠETKÝMI premennými, ktoré projekt kedy použije (DATABASE_URL, REDIS_URL, JWT_SECRET,
>   STRIPE_SECRET_KEY…), s komentármi.
> - `pnpm dev` spustí server + dashboard + demo paralelne cez turbo.
>
> **CI:** `.github/workflows/ci.yml` — pnpm cache, `lint` + `typecheck` + `build` + `test`,
> service containers postgres+redis pre integračné testy. Matrix nie je potrebný, Node 22.
>
> **Akceptačné kritériá:** `docker compose up -d && pnpm install && pnpm build && pnpm test`
> prejde načisto; `/healthz` vráti 200 s `{db: "ok", redis: "ok"}`; wscat pripojenie na
> `/v1/realtime` + ping/pong funguje. Commitni.

---

## PROMPT 2 — Dátový model, migrácie, seed, repository vrstva

> V `apps/server` vybuduj kompletnú DB vrstvu cez Drizzle ORM.
>
> **Schéma (`apps/server/src/db/schema.ts`), všetko s created_at/updated_at, UUID v7 PK:**
> - `organizations` (name, slug unique, plan enum: free/pro/scale/enterprise, stripe_customer_id nullable)
> - `users` (email unique, name, password_hash nullable — kvôli OAuth neskôr) + `organization_members`
>   (org_id, user_id, role enum: owner/admin/member, unique(org_id,user_id))
> - `projects` (org_id FK, name, slug, environment enum: dev/prod) — zákaznícka appka
> - `api_keys` (project_id FK, prefix — prvých 8 znakov na identifikáciu, key_hash — sha256,
>   scopes text[], last_used_at, revoked_at nullable). Kľúč sa zobrazí len raz pri vytvorení.
> - `end_users` (project_id, external_id — ID usera v zákazníkovej appke, display_name, avatar_url,
>   metadata jsonb, unique(project_id, external_id))
> - `rooms` (project_id, external_id, metadata jsonb, unique(project_id, external_id))
> - `comments` (room_id, thread_id self-FK nullable, end_user_id, body text, anchor jsonb —
>   selektor kam je komentár ukotvený, resolved_at nullable, deleted_at nullable — soft delete)
> - `notifications` (end_user_id, type, payload jsonb, read_at nullable)
> - `usage_events` (project_id, kind enum: connection_minutes/message/mau, quantity, occurred_at,
>   index na (project_id, occurred_at)) — základ pre metering v Prompte 8.
> - `webhook_endpoints` (project_id, url, secret, events text[], disabled_at nullable)
>
> **Ďalej:**
> - Drizzle migrácie (drizzle-kit), skript `db:migrate` a `db:seed` (seed: 1 org, 1 user
>   heslo `demo1234`, 2 projekty dev+prod, API kľúč s vypísaním do konzoly, 5 end_users, 1 room,
>   ukážkové komentáre).
> - Repository vrstva `apps/server/src/repos/*.ts` — žiadne raw drizzle volania mimo repos.
>   Každá repo funkcia typovaná cez typy z `packages/core`.
> - Integračné testy repos proti reálnemu Postgresu (testcontainers alebo compose DB s
>   izoláciou cez transakcie/truncate medzi testami) — minimálne CRUD + unique constrainty
>   + soft delete správanie pre comments.
>
> **Akceptačné kritériá:** `pnpm db:migrate && pnpm db:seed` beží idempotentne; testy zelené;
> žiadny dotaz mimo repository vrstvy. Commitni.

---

## PROMPT 3 — Realtime jadro: rooms, presence, pub/sub, škálovanie

> Toto je srdce produktu. V `apps/server` implementuj plný realtime engine na endpointe
> `/v1/realtime?token=<client_jwt>`.
>
> **Protokol (rozšír `packages/core`):**
> - Handshake: klient sa pripája s JWT (vydáme ho v Prompte 4; teraz sprav verifikáciu proti
>   JWT_SECRET s claimmi `projectId`, `endUserId`, `displayName`). Neplatný token → close code 4401.
> - Správy client→server: `join_room {roomExternalId}`, `leave_room`, `presence_update {data}` —
>   ľubovoľný JSON do 1 kB (kurzor, selection…), `broadcast {event, payload}` — custom eventy,
>   `ping`. Všetko validované zodom z `packages/core`; nevalidná správa → `error` správa, nie crash.
> - Správy server→client: `room_joined {roomId, presence: [...], seq}`, `presence_diff {joined, left, updated}`,
>   `broadcast_received`, `error {code, message}`, `pong`.
> - Každá server správa má monotónne `seq` per room, aby klient vedel detegovať výpadok.
>
> **Architektúra:**
> - `ConnectionManager` — drží WS spojenia, heartbeat (server ping každých 30 s, mŕtve spojenie
>   po 2 zmeškaných pongoch terminate), limit spojení per end_user (5) a per project (podľa plánu, zatiaľ konštanta).
> - `RoomHub` — membership v pamäti + **Redis pub/sub** kanál `room:{projectId}:{roomExternalId}`,
>   aby fungovalo viac inštancií servera súčasne. Presence ukladaj do Redis hash s TTL, nie do Postgresu.
> - Backpressure: ak WS buffer > 1 MB, správy pre daného klienta zahadzuj s počítadlom a pošli
>   `error {code: "slow_consumer"}`; pri 5 MB spojenie zatvor 1013.
> - Rate limit: max 50 správ/s per spojenie (token bucket), prekročenie → error, opakovane → close 4429.
> - Pri disconnect-e zapíš `usage_events` (connection_minutes).
>
> **Testy:** integračné testy s reálnymi WS klientmi (balík `ws`): join/leave, presence diff medzi
> 2 klientmi, broadcast, rate limit, slow consumer, **a kľúčový test: 2 inštancie servera na rôznych
> portoch so spoločným Redisom — klient na inštancii A vidí presence klienta na inštancii B.**
>
> **Akceptačné kritériá:** všetky testy zelené; server prežije kill -9 jednej inštancie bez dopadu
> na druhú; žiadny memory leak pri 1000 connect/disconnect cykloch (test s meraním heapu). Commitni.

---

## PROMPT 4 — Auth, API keys, REST API, webhooky, security hardening

> **Server-to-server auth:** middleware pre `Authorization: Bearer sk_<env>_<key>` — lookup cez
> prefix, porovnanie sha256 hashu (timing-safe), kontrola scopes a revoked_at, update last_used_at
> (throttled, max raz za minútu).
>
> **REST API `apps/server/src/routes/v1/` (všetko zod-validované, OpenAPI cez fastify-swagger):**
> - `POST /v1/tokens` — zákazníkov backend si vymení API key za client JWT pre svojho usera:
>   body `{externalUserId, displayName?, avatarUrl?, metadata?}` → upsert `end_users`, vráť JWT (TTL 1 h)
>   + refresh mechanizmus.
> - `GET/POST /v1/rooms`, `GET /v1/rooms/:externalId/presence` (z Redisu)
> - `GET/POST/PATCH/DELETE /v1/rooms/:externalId/comments` — vláknové (thread_id), resolve/unresolve,
>   soft delete, pagination (cursor-based, limit max 100). POST komentára pushne realtime event
>   `comment_created` do roomu cez RoomHub a vytvorí `notifications` pre účastníkov threadu.
> - `GET /v1/users/:externalId/notifications` + `POST .../read`
>
> **Webhooky:** pri `comment.created`, `comment.resolved` odošli POST na `webhook_endpoints`
> s HMAC-SHA256 podpisom v hlavičke `X-SyncKit-Signature` (timestamp + tolerancia 5 min proti
> replay). Retry: 3× s exponenciálnym backoffom cez jednoduchú in-process queue s perzistenciou
> do Postgresu (tabuľka `webhook_deliveries` — pridaj migráciu).
>
> **Hardening:** rate limit REST (per API key: 100 req/min free, konštanty do configu), helmet
> ekvivalent pre Fastify, CORS len pre dashboard origin, request-id + pino structured logging
> (redakcia tokenov v logoch), audit trail do logu pre všetky mutácie.
>
> **Testy:** auth (zlý kľúč, revoked kľúč, zlé scopes, expirovaný JWT), celý comments CRUD flow,
> webhook podpis + retry (fake endpoint čo 2× zlyhá), rate limit. **Akceptačné kritériá:**
> OpenAPI JSON na `/v1/openapi.json` kompletná; všetky testy zelené. Commitni.

---

## PROMPT 5 — `@synckit/client`: produkčný vanilla SDK

> V `packages/client` vybuduj SDK, ktoré si zákazník nainštaluje z npm. Toto je tvár produktu —
> DX musí byť špičková.
>
> **API dizajn:**
> ```ts
> const client = createClient({ tokenProvider: async () => fetch("/api/synckit-token")… });
> const room = client.joinRoom("doc-123", { initialPresence: { cursor: null } });
> room.presence.update({ cursor: { x, y } });
> const unsub = room.presence.subscribe(others => …);      // ostatní, nie ja
> room.broadcast.emit("reaction", { emoji: "🔥" });
> room.broadcast.on("reaction", handler);
> const comments = room.comments;                           // list/create/reply/resolve, realtime updated
> client.notifications.subscribe(handler);
> await room.leave(); client.disconnect();
> ```
>
> **Implementačné požiadavky:**
> - Connection state machine: `idle → connecting → connected → reconnecting → closed`, verejne
>   observovateľná (`client.status`, `client.on("status", …)`).
> - Reconnect s exponenciálnym backoffom + jitter (1 s → max 30 s), automatický re-join všetkých
>   rooms a re-publish poslednej presence po reconnect-e. Token refresh cez `tokenProvider` pri 4401.
> - Offline buffer pre `broadcast` a `presence_update` (max 100 správ, potom drop najstarších).
> - Detekcia straty správ cez `seq` — pri diere room refetch cez REST (`/presence`, comments delta).
> - Všetky typy zdieľané z `packages/core`; žiadna závislosť okrem zod (a WebSocket polyfill
>   len pre Node — cez podmienený import).
> - Build cez tsup: ESM + CJS + d.ts, `sideEffects: false`, bundle < 15 kB gzip (CI check).
>
> **Testy:** unit testy state machine a bufferov s fake WS; integračné testy proti reálnemu
> serveru z apps/server — vrátane testu reconnectu (server killne spojenie, klient sa do 5 s
> obnoví aj s presence). **Akceptačné kritériá:** testy zelené, size-limit check v CI prechádza,
> `pnpm --filter @synckit/client build` produkuje publikovateľný balík. Commitni.

---

## PROMPT 6 — `@synckit/react`: hooks + hotové UI komponenty

> V `packages/react` postav React SDK nad `@synckit/client` + hotové UI komponenty (to je to,
> čo predáva — integrácia za hodinu).
>
> **Hooks:** `SyncKitProvider` (client v contexte), `RoomProvider`, `useOthers()`, `useMyPresence()`,
> `useUpdateMyPresence()` (throttlovaný na 60 ms), `useBroadcastEvent()`/`useEventListener()`,
> `useComments(anchor?)`, `useNotifications()`, `useConnectionStatus()`. Všetko so selektormi
> proti zbytočným re-renderom (useSyncExternalStore).
>
> **Komponenty (Tailwind-free — čisté CSS custom properties, aby nekolidovali so zákazníkovým CSS;
> theming cez `--synckit-*` premenné):**
> - `<LiveCursors />` — kurzory ostatných s menom, plynulá interpolácia (rAF, nie CSS transition na každý update)
> - `<PresenceAvatars max={5} />` — stack avatarov + „+N"
> - `<CommentsThread anchor="…" />` — kompletné vlákno: composer, replies, resolve, optimistické
>   updaty s rollbackom, relative timestamps
> - `<NotificationInbox />` — zvonček s badge + dropdown zoznam, mark-as-read
> - `<CommentPin />` — plávajúci pin ukotvený na element (data-synckit-anchor)
>
> **Kvalita:** Storybook pre všetky komponenty (s mock providerom); a11y — focus management,
> aria atribúty, klávesnica v komentároch; React 18+ peer dependency, RSC-safe („use client" kde treba).
>
> **Testy:** Vitest + Testing Library pre hooks (fake client) a komponenty; jeden integračný test
> dvoch React klientov proti reálnemu serveru (vidia si navzájom kurzory).
> **Akceptačné kritériá:** Storybook beží, testy zelené, tsup build ESM+CJS+d.ts. Commitni.

---

## PROMPT 7 — Dashboard: onboarding, projekty, API keys, live metriky

> V `apps/dashboard` postav plnohodnotný zákaznícky dashboard (Next.js 15 App Router, shadcn/ui).
>
> **Auth:** email+heslo (argon2) cez vlastné session cookies (httpOnly, secure, SameSite=Lax,
> session tabuľka v DB — pridaj migráciu v apps/server schéme), signup vytvorí organizáciu.
> Middleware chráni všetko okrem `/login`, `/signup`. Pozvánky členov (email link s tokenom,
> zatiaľ vypisuj link do konzoly — SMTP až v produkcii).
>
> **Stránky:**
> - `/onboarding` — 3 kroky: vytvor projekt → skopíruj API key → quickstart snippet (tabs:
>   React/JS/curl) s live „waiting for first connection…" checkom (poll na usage API).
> - `/projects/[slug]` — prehľad: aktívne spojenia teraz (z Redisu cez server API), MAU, správy/deň —
>   graf za 30 dní (recharts) z `usage_events`.
> - `/projects/[slug]/api-keys` — list (prefix, last_used, scopes), create (modal zobrazí kľúč
>   PRÁVE RAZ s copy buttonom a varovaním), revoke s potvrdením.
> - `/projects/[slug]/rooms` — zoznam roomov, detail: live presence (server-sent events alebo
>   polling 5 s), komentáre s moderáciou (delete).
> - `/projects/[slug]/webhooks` — CRUD endpointov, log posledných deliveries so statusmi, "resend".
> - `/settings/organization` — členovia, role, rename; `/settings/billing` — placeholder pre Prompt 8.
>
> Dashboard volá server API cez interný service token — pridaj do apps/server interné routes
> `/internal/*` chránené separátnym INTERNAL_API_SECRET, nikdy nevystavené SDK zákazníkom.
>
> **Testy:** Playwright e2e — signup → onboarding → create key → (skriptovaný WS klient sa pripojí)
> → dashboard ukáže 1 aktívne spojenie → revoke key → klient dostane 4401.
> **Akceptačné kritériá:** e2e zelené v CI (compose služby + oba appy). Commitni.

---

## PROMPT 8 — Billing: Stripe, plány, metering, enforcement

> **Plány (konštanty v `packages/core/src/plans.ts`):**
> - Free: 100 MAU, 10 súčasných spojení, 1 projekt, história komentárov 30 dní
> - Pro €49/mes: 1 000 MAU, 100 spojení, 5 projektov + metered MAU nad limit €0.05/MAU
> - Scale €299/mes: 10 000 MAU, 1 000 spojení, neobmedzené projekty
> - Enterprise: custom (kontakt)
>
> **Implementácia:**
> - Stripe: produkty/ceny cez idempotentný bootstrap skript `pnpm stripe:bootstrap`; checkout
>   session na upgrade z `/settings/billing`; customer portal na správu; webhook handler
>   (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid/payment_failed`)
>   s verifikáciou podpisu a idempotenciou (tabuľka `stripe_events`, migrácia).
> - Metering: agregačný job (node-cron v serveri, s pg advisory lock aby bežal len na 1 inštancii)
>   — každú hodinu zroluje `usage_events` do `usage_daily` (migrácia) a raz denne reportne metered
>   usage do Stripe.
> - **Enforcement v reálnom čase:** limity čítané z plánu organizácie, cache v Redise (TTL 60 s):
>   nový WS connect nad limit spojení → close 4403 s dôvodom; MAU limit na free → nové `POST /v1/tokens`
>   vracia 402 s upgrade linkom; `payment_failed` → grace perióda 7 dní (banner v dashboarde), potom downgrade na free.
> - `/settings/billing`: aktuálny plán, usage bary (MAU, spojenia, projekty) s percentami, upgrade
>   CTA, faktúry (zo Stripe API).
>
> **Testy:** webhook handler s fixture eventmi (podpis, idempotencia — 2× ten istý event = 1 zmena),
> enforcement testy (mock plán → WS connect nad limit odmietnutý, tokens 402), rollup job test.
> Stripe volania za interface `BillingProvider` s fake implementáciou pre testy — reálne kľúče
> netreba. **Akceptačné kritériá:** celý upgrade flow klikateľný proti Stripe test mode
> (s STRIPE_SECRET_KEY v .env), testy zelené bez Stripe kľúčov. Commitni.

---

## PROMPT 9 — Kvalita: load testy, chaos, security audit, DX polish

> Toto je prompt, ktorý oddeľuje „side project" od „due diligence ready".
>
> **Load testing (k6, adresár `load/`):**
> - Scenár A: 2 000 súčasných WS spojení v 50 roomoch, presence update 2/s per klient, 10 min —
>   assert p95 doručenia presence < 150 ms, 0 dropov pri limite.
> - Scenár B: REST comments 200 rps, p95 < 100 ms.
> - Spusti proti 2 inštanciám servera, výsledky ulož do `load/RESULTS.md` (reálne namerané čísla —
>   budú v predajnom pitchi).
>
> **Chaos/odolnosť testy (automatizované, vitest):** reštart Redisu počas prevádzky (server sa
> re-subscribne, klienti neodpadnú), reštart Postgresu (REST vracia 503 s Retry-After, WS beží ďalej),
> kill jednej server inštancie (klienti sa reconnectnú na druhú do 5 s).
>
> **Security audit (sprav a oprav, výsledky do `SECURITY.md`):**
> - Prejdi OWASP top 10 proti REST aj WS; over: IDOR na všetkých routes (project scoping!),
>   JWT alg confusion (pin HS256), zod na 100 % vstupov vrátane query/params, SQLi (drizzle
>   parametrizuje — over raw queries), rate limity, secrets nikdy v logoch, comments XSS
>   (sanitizácia body na SDK aj dashboard strane), webhook SSRF (blokni private IP ranges).
> - `pnpm audit` + zafixuj; CodeQL workflow do CI; dependabot config.
>
> **DX polish:** `CONTRIBUTING.md` (setup do 5 minút), `pnpm doctor` skript (skontroluje Node
> verziu, docker, .env), pre-commit hook (lint-staged), spoločný error formát API zdokumentovaný,
> changesets na verzovanie balíkov.
>
> **Akceptačné kritériá:** load výsledky spĺňajú SLA a sú zapísané, chaos testy zelené v CI
> (compose restart), SECURITY.md hotové s odškrtnutým checklistom, CodeQL zelený. Commitni.

---

## PROMPT 10 — Produkcia, dokumentácia, demo, launch/akvizičný balíček

> **Deployment:**
> - Multi-stage Dockerfiles pre server (distroless, non-root) a dashboard (standalone output).
> - `docker-compose.prod.yml` + `DEPLOY.md`: presný postup na Hetzner/Fly.io — 2× server inštancia
>   za load balancerom (sticky nie je potrebné — over!), managed Postgres + Redis, TLS, health checks,
>   zero-downtime deploy (rolling), backup stratégia (pg_dump denne + PITR poznámky).
> - GitHub Actions: release workflow — build + push images (ghcr.io), changesets publish SDK
>   balíkov na npm (dry-run ak chýba NPM_TOKEN).
> - Observability: OpenTelemetry traces + metriky (aktívne spojenia, správy/s, doručovacia latencia,
>   WS close codes) exportované na `/metrics` (Prometheus formát), Grafana dashboard JSON v `infra/grafana/`.
>
> **Dokumentácia (`apps/docs` — Nextra alebo Fumadocs):**
> - Quickstart (React aj vanilla, < 10 min), koncepty (rooms, presence, tokens), kompletná SDK
>   API referencia (generovaná z TSDoc cez typedoc), REST referencia (z OpenAPI), webhooks guide,
>   self-hosting guide, limity a plány. Všetko po anglicky — kupci sú globálni.
>
> **Demo appka (`apps/demo`) — predajný nástroj č. 1:**
> - „Collaborative product board": kanban board kde reálne funguje všetko naraz — live kurzory,
>   avatary, drag&drop kariet syncnutý cez broadcast, komentáre na kartách s pinmi, notifikácie.
>   Seed s peknými dátami, deployovateľná na jednu URL, `?user=alice|bob` na okamžité 2-user demo
>   v dvoch taboch.
>
> **Akvizičný balíček (`PITCH.md`):** one-pager — čo produkt robí, architektúrny diagram (mermaid),
> namerané čísla z load testov, unit economics (COGS per 1k spojení), porovnanie s Liveblocks/Cord/Pusher,
> integračný čas (hodiny nie mesiace), roadmap (CRDT storage, mobile SDK, SOC2). + `README.md`
> root — profesionálny, s gifom demo appky, badges, quickstartom.
>
> **Akceptačné kritériá:** `docker compose -f docker-compose.prod.yml up` lokálne funguje end-to-end
> (demo → server → dashboard ukazuje usage), docs buildia, README + PITCH hotové. Finálny commit + tag `v1.0.0`.

---

## Ako pracovať s týmto plánom

1. Posielaj prompty **v poradí 1 → 10**, vždy jeden na novú konverzáciu/session.
2. Na začiatok každej session stačí: *„Pokračuj podľa PROMPTS.md — sprav PROMPT N"* — celý text
   promptu je v tomto súbore, netreba ho kopírovať.
3. Po každom prompte skontroluj akceptačné kritériá pred pokračovaním.

## Presun do nového súkromného repozitára

Táto session má prístup len k `lutimir/webosockets`, preto plán žije tu. Keď si založíš
private repo (napr. `lutimir/synckit`):

```bash
git clone https://github.com/lutimir/webosockets --branch claude/million-euro-web-app-sbzry2 synckit-src
cd synckit-src
git remote set-url origin https://github.com/lutimir/synckit.git
git push -u origin claude/million-euro-web-app-sbzry2:main
```

Potom nové Claude sessions spúšťaj už nad novým repom.
