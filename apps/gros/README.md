# 🪙 Groš

**Najjednoduchší spôsob, ako prijímať príspevky od fanúšikov.** Slovenská odpoveď na Buy Me a Coffee / Ko-fi — stránka tvorcu za 2 minúty, jednorazové aj mesačné príspevky, ciele, stena podpory a embedovateľný widget.

## Spustenie

Žiadny build step, žiadne závislosti. Stačí otvoriť v prehliadači alebo pustiť ľubovoľný statický server:

```bash
cd apps/gros
python3 -m http.server 8080
# http://localhost:8080          → landing page
# http://localhost:8080/app.html → appka
```

## Čo je hotové (prompt 1/5)

- **Landing page** (`index.html`) — hero, funkcie, cenník (Štart 0 € / Pro 9 € / Studio 29 €), ukážka widgetu
- **Appka** (`app.html` + `js/app.js`) — hash-routovaná SPA:
  - `#onboard` — vytvorenie stránky tvorcu (meno, slug, avatar, cieľ)
  - `#c/<slug>` — verejná stránka tvorcu: príspevky (2/5/10 € alebo vlastná suma), odkaz, mesačná podpora, progress bar cieľa, stena podpory
  - `#dash` — dashboard: celkové príjmy, počet podporovateľov, mesačná podpora, graf za 14 dní, kopírovanie linku a widget kódu
- **Widget** (`js/widget.js`) — plávajúce tlačidlo podpory na jeden riadok kódu
- **Demo tvorca** — `#c/demo` so seedovanými príspevkami
- Dáta žijú v `localStorage`, platby sú **simulované** (checkout modal s kartou / Apple Pay / Google Pay)

## Roadmapa — zvyšné 4 prompty

| Prompt | Čo pribudne |
|---|---|
| **2** | Reálny backend: Node/Express API + SQLite, účty tvorcov, sessions |
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
└── js/
    ├── app.js      # router + views + localStorage store + simulovaný checkout
    └── widget.js   # embedovateľné tlačidlo podpory
```

`checkout()` v `app.js` je jediné miesto, ktoré treba vymeniť za Stripe Checkout session — zvyšok appky je na to pripravený.
