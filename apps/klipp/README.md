# ✂️ Klipp

**Výkonnostný marketplace pre influencerov a klipperov.** Influencer vypíše kampaň s rozpočtom a sadzbou za 1 000 zhliadnutí. Klipperi strihajú klipy z jeho obsahu, šíria ich na TikTok / Reels / Shorts a zarábajú podľa reálneho dosahu. Influencer platí len za skutočné zhliadnutia — ani cent navyše.

> Model, na ktorom dnes klipperi reálne zarábajú (clipping campaigns à la Whop) — tu ako vlastná platforma s 10 % províziou z vyplatených odmien.

## Spustenie

Žiadny build step, žiadne závislosti:

```bash
cd apps/klipp
python3 -m http.server 8080
# http://localhost:8080          → landing page
# http://localhost:8080/app.html → appka
```

## Čo je hotové

### Prompt 1/10 — produkt (demo v prehliadači)

- **Landing page** (`index.html`) — hero, ako to funguje, sekcia pre klipperov, poplatky (klipper 0 €, influencer 10 % z odmien)
- **Appka** (`app.html` + `js/app.js`) — hash-routovaná SPA s prepínačom rolí ✂️ Klipper / 🎤 Influencer:
  - **Zoznam kampaní** — sadzba €/1000 👁️, platformy, rozpočtový progress bar, otvorená/uzavretá
  - **Detail kampane** (`#k/<id>`) — pravidlá, odoslanie klipu (URL + platforma), zoznam klipov
  - **Klipper dashboard** (`#moje`) — zarobené €, zhliadnutia, stavy klipov, sync tlačidlo
  - **Influencer dashboard** (`#kampane`) — vyplatené €, získané views, priemerná cena za 1000 👁️, schvaľovanie/zamietanie klipov
  - **Nová kampaň** (`#new`) — názov, sadzba, rozpočet, platformy, pravidlá
- **Férová ekonomika** — zárobky schválených klipov sa počítajú v poradí odoslania a sú **kumulatívne zastropované rozpočtom** kampane; pending klipy ukazujú potenciálny zárobok (~)
- **Simulované zhliadnutia** — každý klip má skrytý „viral faktor", sync pridáva rast klesajúci s vekom klipu; v produkcii to nahradí čítanie z API platforiem
- Dáta v `localStorage`, seed s 3 kampaňami a 5 klipmi

## Roadmapa — zvyšných 9 promptov

| Prompt | Čo pribudne |
|---|---|
| **2** | Backend: Node + SQLite API (zero-dep), účty influencer/klipper, sessions |
| **3** | Overovanie zhliadnutí: oEmbed/API TikTok · YouTube · IG, automatický sync na pozadí |
| **4** | Stripe: influencer nabije rozpočet kampane vopred (escrow), 10 % fee platformy |
| **5** | Výplaty klipperom: Stripe Connect, minimálny prah 10 €, história výplat |
| **6** | Anti-fraud: detekcia kúpených views, duplicitných klipov, banovanie |
| **7** | Real-time: WebSocket ticker zárobkov, notifikácie „klip schválený / vyplatené" |
| **8** | Leaderboard klipperov, profily, pozvánky do privátnych kampaní |
| **9** | Admin panel platformy: metriky GMV, spory, moderácia |
| **10** | Deploy + launch: SEO/OG, onboarding e-maily, pitch deck |

## Biznis model

- Klipper platí **0 €** — láka supply stranu (strihať vie každý s CapCutom)
- Influencer platí **10 % z reálne vyplatených odmien** — príjem platformy rastie priamo s GMV
- Rozpočty kampaní sú v produkcii zamknuté vopred (escrow) → dôvera klipperov + float pre platformu

## Architektúra

```
apps/klipp/
├── index.html      # landing page
├── app.html        # SPA shell s prepínačom rolí
├── css/style.css   # design system (dark + neon lime/magenta)
└── js/app.js       # router + views + doménová logika (stropy rozpočtov, sync views)
```

Kľúčová doménová logika je v `earningsFor()` — deterministické rozdelenie rozpočtu medzi schválené klipy — a `syncViews()` — jediné miesto, ktoré v prompte 3 nahradí reálne API platforiem.
