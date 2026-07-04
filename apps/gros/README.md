# 🪙 Groš

**Najjednoduchší spôsob, ako prijímať príspevky od fanúšikov.** Slovenská odpoveď na Buy Me a Coffee / Ko-fi — stránka tvorcu za 2 minúty, jednorazové aj mesačné príspevky, ciele, stena podpory a embedovateľný widget.

## Spustenie

Žiadne závislosti, žiadny build step — stačí Node 22+ (kvôli vstavanému `node:sqlite`):

```bash
cd apps/gros
node server/server.js
# http://localhost:8080          → landing page
# http://localhost:8080/app.html → appka (režim s API + SQLite)
```

Bez backendu to funguje tiež — otvor `app.html` cez ľubovoľný statický server a appka sa automaticky prepne do **demo režimu** (localStorage):

```bash
python3 -m http.server 8080
```

## Čo je hotové

### Prompt 1/5 — produkt

- **Landing page** (`index.html`) — hero, funkcie, cenník (Štart 0 € / Pro 9 € / Studio 29 €), ukážka widgetu
- **Appka** (`app.html` + `js/app.js`) — hash-routovaná SPA:
  - `#onboard` — vytvorenie stránky tvorcu (meno, slug, avatar, cieľ)
  - `#c/<slug>` — verejná stránka tvorcu: príspevky (2/5/10 € alebo vlastná suma), odkaz, mesačná podpora, progress bar cieľa, stena podpory
  - `#dash` — dashboard: celkové príjmy, počet podporovateľov, mesačná podpora, graf za 14 dní, kopírovanie linku a widget kódu
- **Widget** (`js/widget.js`) — plávajúce tlačidlo podpory na jeden riadok kódu
- **Demo tvorca** — `#c/demo` so seedovanými príspevkami
- Platby sú **simulované** (checkout modal s kartou / Apple Pay / Google Pay)

### Prompt 2/5 — backend

- **API server** (`server/server.js`) — čistý `node:http`, žiadne npm závislosti, servíruje aj statické súbory
- **SQLite databáza** (`server/db.js`) — vstavané `node:sqlite`, tabuľky `creators`, `tips`, `sessions`, WAL režim
- **Účty tvorcov** — registrácia s heslom (scrypt + salt, timing-safe porovnanie), prihlásenie, odhlásenie
- **Sessions** — httpOnly cookie `gros_session`, 30 dní
- **Store vrstva vo frontende** — `RemoteStore` (API) / `LocalStore` (localStorage); appka si cez `GET /api/health` sama zistí, či beží backend
- **Login obrazovka** (`#login`) + odhlásenie v dashboarde
- Validácia vstupov na serveri (slug, sumy 0,50 – 10 000 €, dĺžky textov, rezervované slugy)

#### API prehľad

| Metóda | Cesta | Popis |
|---|---|---|
| GET | `/api/health` | healthcheck (frontend podľa neho volí režim) |
| POST | `/api/register` | nový tvorca `{slug, name, password, emoji, tagline, goal}` |
| POST | `/api/login` | prihlásenie `{slug, password}` |
| POST | `/api/logout` | odhlásenie |
| GET | `/api/me` | kto som (podľa session cookie) |
| GET | `/api/creators/:slug` | verejný profil + príspevky |
| POST | `/api/creators/:slug/tips` | nový príspevok `{name, amount, msg, monthly}` |

## Roadmapa — zvyšné 3 prompty

| Prompt | Čo pribudne |
|---|---|
| **3** | **Stripe Checkout** — reálne platby (jednorazové aj subscriptions), webhooky |
| **4** | Integrácia s curling hrou v tomto repe (widget in-game), verejný katalóg tvorcov, notifikácie cez existujúci WebSocket server |
| **5** | Polish na predaj: onboarding e-maily, admin štatistiky, SEO/OG karty, deploy (Vercel/Fly.io) a pitch deck |

## Biznis model

- **0 % provízia prvý rok** ako growth hack, potom 5 % na free pláne
- **Pro 9 €/mes** — predplatné pre tvorcov, provízia 2 %, mesačná podpora fanúšikov, widget bez brandingu
- **Studio 29 €/mes** — tímy, API, 0 % provízia

Príjem teda rastie s GMV (percentá z príspevkov) aj so SaaS predplatným — presne kombinácia, ktorú kupci platformy oceňujú.

## Architektúra

```
apps/gros/
├── index.html      # landing page
├── app.html        # SPA shell
├── css/style.css   # zdieľaný design system (dark, gold akcent)
├── js/
│   ├── app.js      # router + views + store vrstva (Remote/Local) + simulovaný checkout
│   └── widget.js   # embedovateľné tlačidlo podpory
└── server/
    ├── server.js   # HTTP server: REST API + statické súbory (node:http)
    └── db.js       # SQLite vrstva: creators, tips, sessions (node:sqlite)
```

`checkout()` v `app.js` je jediné miesto, ktoré treba vymeniť za Stripe Checkout session — zvyšok appky je na to pripravený. Backend zámerne nemá ani jednu npm závislosť: `node server/server.js` a beží.
