# Zadanie 3 – Online Curling (WebSocket hra pre dvoch hráčov)

## Popis projektu

Online hra inšpirovaná curlingom pre dvoch hráčov v reálnom čase. Každý hráč hrá vo vlastnom prehliadači. Komunikácia medzi hráčmi prebieha cez **WebSocket** protokol. Fyzika (kolízie, odrazy, trenie) je implementovaná pomocou knižnice **Matter.js**. Rendering hracej plochy je realizovaný pomocou **Canvas API**. Aplikácia obsahuje autentifikačný systém (login, registrácia, guest), leaderboard, štatistiky hier, lobby chat a admin panel — všetko nad PHP + MySQL backendom.

---

## Odovzdávané súbory

- **SQL dump databázy:** `odovzdanie/curling_db.sql`
- **Nginx konfiguračný súbor:** `odovzdanie/nginx.conf`
- **Technická správa (README):** tento súbor (`src/README.md`)

---

## Použité technológie, frameworky a knižnice

| Technológia | Verzia | Účel |
|---|---|---|
| **Node.js** | v24.14.1 (LTS) | Runtime pre WebSocket server |
| **npm** | v11.11.0 | Správca balíkov pre Node.js |
| **ws** | ^8.18.0 | Knižnica pre WebSocket server (Node.js) |
| **Matter.js** | 0.20.0 (CDN) | Fyzikálny engine (kolízie, trenie, odrazy) |
| **Canvas API** | natívne v prehliadači | Rendering hracej plochy |
| **WebSocket API** | natívne v prehliadači | Komunikácia klient → server v reálnom čase |
| **PHP** | 8.4 (php8.4-fpm) | Backend API (autentifikácia, štatistiky, lobby chat) |
| **MySQL/MariaDB** | na serveri | Databáza (užívatelia, štatistiky, lobby chat) |
| **Nginx** | 1.28.1 | Webový server + reverse proxy pre WebSocket |
| **NVM** | 0.40.4 | Správa verzií Node.js na serveri |
| **systemd** | systémový | Správa WebSocket serveru ako daemona |

### Frontend (bez externých frameworkov)
- **Vanilla JavaScript** — žiadny React, Vue ani jQuery
- **Matter.js** (CDN) — fyzika kameňov (kolízie, trenie, odrazy)
- **Canvas API** — kreslenie hracej plochy
- **Fetch API** — HTTP volania na PHP API (auth, stats, leaderboard, lobby chat)

### Backend
- **Node.js + ws** — WebSocket server pre real-time hernú komunikáciu
- **PHP 8.4** — REST API pre autentifikáciu, štatistiky a lobby chat
- **MySQL** — perzistentné úložisko (užívatelia, výsledky hier, lobby správy)

---

## Štruktúra projektu

```
zadanie3/                         ← /var/www/node69.webte.fei.stuba.sk/zadanie3/
├── config.php                    ← DB pripojenie, migrácie, auto-vytvorenie admin účtu
├── api/
│   ├── auth.php                  ← Registrácia, login, guest, logout, session kontrola
│   ├── leaderboard.php           ← Top 5 hráčov, štatistiky hráča
│   ├── lobby.php                 ← Lobby chat (CRUD správ)
│   └── stats.php                 ← Zápis výsledkov hier, admin editácia štatistík
├── curling/
│   ├── index.html                ← Hlavná stránka (všetky obrazovky v jednom HTML)
│   ├── style.css                 ← Kompletné štýly (dark/light téma, responsive)
│   └── game.js                   ← Herná logika, Canvas, WebSocket klient, auth UI
├── 404.html                      ← Vlastná chybová stránka

~/ws-server/                      ← WebSocket server (v home adresári)
├── server.js                     ← WebSocket server — autorita nad stavom hry
├── config.json                   ← Konfigurácia hry (kamene, fyzika, pole)
├── package.json                  ← Definícia Node.js projektu a závislostí
└── package-lock.json             ← Lockfile pre presné verzie závislostí

odovzdanie/                       ← Súbory na odovzdanie
├── curling_db.sql                ← SQL dump databázy
└── nginx.conf                    ← Nginx konfiguračný súbor
```

**Dôležité:** Adresár `node_modules/` sa neodovzdáva. Po stiahnutí projektu je nutné spustiť `npm install`.

---

## Dodatočne inštalované systémové balíky

Na serveri `node69.webte.fei.stuba.sk` boli doinstalované nasledovné balíky:

| Balík | Príkaz inštalácie | Účel |
|---|---|---|
| **NVM** (Node Version Manager) | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh \| bash` | Správa verzií Node.js |
| **Node.js v24.14.1** | `nvm install 24` | Runtime pre WebSocket server |
| **npm v11.11.0** | (súčasť Node.js) | Správca balíkov |
| **ws v8.18.0** | `npm install` (z package.json) | WebSocket knižnica pre Node.js |

> **Poznámka:** PHP 8.4, MySQL, Nginx a phpMyAdmin boli na serveri už predinstalované.

---

## Zmeny v konfigurácii VPS a servera

### 1. Inštalácia Node.js cez NVM

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24
```

Overenie:
```sh
node -v   # v24.14.1
npm -v    # 11.11.0
```

### 2. Inštalácia závislostí WebSocket serveru

```sh
cd ~/ws-curling
npm install
```

Nainštaluje sa knižnica `ws` (^8.18.0) — čistá WebSocket implementácia pre Node.js.

### 3. Konfigurácia Nginx — reverse proxy pre WebSocket

Kompletný konfiguračný súbor je v `odovzdanie/nginx.conf`.

Cesta na serveri: `/etc/nginx/sites-available/node69.webte.fei.stuba.sk`

Kľúčové zmeny oproti predvolenej konfigurácii:

**a) Presmerovanie HTTP → HTTPS:**
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name node69.webte.fei.stuba.sk;
    rewrite ^ https://$server_name$request_uri? permanent;
}
```

**b) SSL certifikát:**
```nginx
ssl_certificate /etc/ssl/certs/webte_fei_stuba_sk.pem;
ssl_certificate_key /etc/ssl/private/webte.fei.stuba.sk-ec.key;
```

**c) PHP-FPM 8.4:**
```nginx
location ~ \.php$ {
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:/var/run/php/php8.4-fpm.sock;
}
```

**d) WebSocket reverse proxy (kľúčová zmena pre zadanie 3):**

Do súboru `/etc/nginx/sites-available/node69.webte.fei.stuba.sk` bol pridaný nasledovný `location` blok:

```nginx
location /zadanie3/ws/ {
    proxy_pass http://localhost:3000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
}
```

**Čo to robí:**
- `proxy_pass` presmeruje požiadavky na Node.js WebSocket server bežiaci na porte 3000
- `proxy_http_version 1.1` je nutné pre WebSocket upgrade mechanizmus
- `Upgrade` a `Connection` hlavičky umožňujú prepnutie z HTTP na WebSocket protokol
- Bez tejto konfigurácie by Nginx vrátil chybu 400/502 a WebSocket by sa neotvoril

**Prečo je to potrebné:**
- WebSocket server beží ako samostatný proces (daemon) na `localhost:3000`
- Port 3000 nie je priamo prístupný zvonka (firewall)
- Nginx slúži ako reverse proxy — prijme HTTPS požiadavku od klienta a prepošle ju na lokálny Node.js server
- SSL certifikát je na Nginx serveri — klient sa pripája cez `wss://` (zabezpečený WebSocket)

Overenie a reload:
```sh
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Vlastná chybová stránka

Do Nginx konfigurácie bola pridaná vlastná 404 stránka:

```nginx
error_page 404 /zadanie3/404.html;
location = /zadanie3/404.html {
    root /var/www/node69.webte.fei.stuba.sk;
    internal;
}
```

### 5. Systemd služba pre WebSocket server

Bol vytvorený súbor `/etc/systemd/system/ws-curling.service`:

```ini
[Unit]
Description=Curling WebSocket Server
After=network.target

[Service]
WorkingDirectory=/home/xlutisan/ws-server
ExecStart=/home/xlutisan/.nvm/versions/node/v24.14.1/bin/node server.js
Restart=always
User=xlutisan

[Install]
WantedBy=multi-user.target
```

**Čo to robí:**
- `WorkingDirectory` — nastaví pracovný adresár pre Node.js (aby vedel nájsť config.json a node_modules)
- `ExecStart` — absolútna cesta k Node.js runtime + server.js
- `Restart=always` — pri páde servera sa automaticky reštartuje
- `User=xlutisan` — beží pod naším používateľom (nie root)
- `WantedBy=multi-user.target` — automaticky sa spustí po boote systému

Aktivácia:
```sh
sudo systemctl daemon-reload
sudo systemctl enable ws-curling    # automatický štart po boote
sudo systemctl start ws-curling     # spustenie
```

Správa:
```sh
sudo systemctl status ws-curling    # stav služby
sudo systemctl stop ws-curling      # zastavenie
sudo systemctl restart ws-curling   # reštart
journalctl -u ws-curling -n 50      # zobrazenie logov
```

---

## Presný a podrobný postup nasadenia riešenia

### Krok 0 — Príprava servera (ak nie je nastavený)

```sh
# Pripojenie na server
ssh xlutisan@147.175.105.69 
# Inštalácia NVM (ak ešte nie je)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24
node -v   # v24.14.1
npm -v    # 11.11.0

# Vytvorenie potrebných adresárov
mkdir -p /var/www/node69.webte.fei.stuba.sk/zadanie3/api
mkdir -p /var/www/node69.webte.fei.stuba.sk/zadanie3/curling
mkdir -p ~/ws-server
```

### Krok 1 — Databáza (phpMyAdmin)

1. Otvor phpMyAdmin na serveri
2. Vytvor databázu `curling_db` s kódovaním `utf8mb4_general_ci` (ak neexistuje)
3. Klikni na záložku **SQL**
4. Vlož obsah súboru `odovzdanie/curling_db.sql` a klikni **Go**
5. Vytvoria sa tabuľky: `users`, `lobby_messages`, `global_stats`

> **Poznámka:** Admin účet (admin/admin) sa vytvorí automaticky cez `config.php` pri prvom PHP requeste.

### Krok 2 — Nahratie PHP a frontend súborov

Z lokálneho PC:
```sh
# PHP backend
scp src/config.php        xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/config.php
scp src/api/auth.php       xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/api/auth.php
scp src/api/leaderboard.php xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/api/leaderboard.php
scp src/api/lobby.php      xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/api/lobby.php
scp src/api/stats.php      xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/api/stats.php

# Frontend
scp src/curling/index.html xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/curling/index.html
scp src/curling/style.css  xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/curling/style.css
scp src/curling/game.js    xlutisan@147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/curling/game.js

# 404 stránka
scp src/404.html           xlutisan@n147.175.105.69:/var/www/node69.webte.fei.stuba.sk/zadanie3/404.html
```

Nastavenie oprávnení na serveri:
```sh
chmod -R 755 /var/www/node69.webte.fei.stuba.sk/zadanie3/
chmod 644 /var/www/node69.webte.fei.stuba.sk/zadanie3/curling/*
```

### Krok 3 — Nahratie WebSocket serveru a inštalácia závislostí

Z lokálneho PC:
```sh
scp ws-server/server.js ws-server/config.json ws-server/package.json ws-server/package-lock.json xlutisan@node69.webte.fei.stuba.sk:~/ws-server/
```

Na serveri — inštalácia závislostí:
```sh
cd ~/ws-server
npm install
```

Tento príkaz nainštaluje knižnicu `ws` (^8.18.0) definovanú v `package.json` do adresára `node_modules/`.

### Krok 4 — Konfigurácia Nginx

```sh
sudo nano /etc/nginx/sites-available/node69.webte.fei.stuba.sk
```

Pridať `location /zadanie3/ws/ { ... }` blok (viď sekcia "Konfigurácia Nginx" vyššie, alebo celý súbor `odovzdanie/nginx.conf`).

```sh
sudo nginx -t
sudo systemctl reload nginx
```

### Krok 5 — Spustenie WebSocket serveru

```sh
sudo systemctl daemon-reload
sudo systemctl enable ws-curling
sudo systemctl start ws-curling
sudo systemctl status ws-curling
```

### Krok 6 — Overenie

```sh
# Test WebSocket cez curl
curl -i --no-buffer \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://node69.webte.fei.stuba.sk/zadanie3/ws/
```

Očakávaný výstup: `HTTP/1.1 101 Switching Protocols`

Otestovať v prehliadači: `https://node69.webte.fei.stuba.sk/zadanie3/curling/`

---

## Riešenie problémov

### Problém: Port 3000 je obsadený (EADDRINUSE)

Ak na porte 3000 beží iná služba (napr. stará `ws-chat`):

```sh
# Zastavenie starých služieb
sudo systemctl stop ws-chat
sudo systemctl disable ws-chat

# Overenie portu
lsof -i :3000

# Ak je stále obsadený
sudo pkill -9 -f "node server.js"

# Spustenie curling serveru
sudo systemctl reset-failed ws-curling
sudo systemctl start ws-curling
```

**Dôležité:** Na jednom porte može bežať len jedna služba. Ak máte `ws-chat` aj `ws-curling`, musia používať rôzne porty. V tom prípade treba upraviť `config.json` alebo premennú `WS_PORT` a Nginx konfigurác.iu.

### Problém: systemd hlási "Start request repeated too quickly"

```sh
sudo systemctl reset-failed ws-curling
sudo systemctl start ws-curling
```

### Problém: 403 Forbidden

```sh
chmod -R 755 /var/www/node69.webte.fei.stuba.sk/zadanie3/
chmod 644 /var/www/node69.webte.fei.stuba.sk/zadanie3/curling/*
```

### Problém: WebSocket sa nepripojí (400/502)

Skontrolovať nginx konfiguráciu — musí mať `location /zadanie3/ws/` (nie `/ws/`).

---

## Konfigurácia hry (config.json)

```json
{
  "stonesPerPlayer": 5,
  "stoneRadius": 18,
  "target": { "x": 300, "y": 150, "radius": 75 },
  "field": { "width": 600, "height": 800 },
  "maxForce": 18,
  "friction": 0.018
}
```

Konfigurácia sa načíta pri každom vytvorení novej hernej miestnosti (hot-reload). Pre zmenu parametrov stačí upraviť `config.json` — pri ďalšej novej hre sa použijú nové hodnoty bez reštartu serveru.

---

## Databáza (MySQL)

SQL dump: `odovzdanie/curling_db.sql`

### Schéma tabuliek

**users** — registrovaní hráči, guest účty a admin:
| Stĺpec | Typ | Popis |
|---|---|---|
| id | INT AUTO_INCREMENT PK | Unikátne ID hráča |
| username | VARCHAR(50) UNIQUE | Meno hráča |
| password | VARCHAR(255) | Bcrypt hash hesla |
| is_guest | TINYINT(1) | 1 = guest účet |
| is_admin | TINYINT(1) | 1 = administrátor |
| games | INT | Celkový počet hier |
| wins | INT | Počet výhier |
| losses | INT | Počet prehier |
| draws | INT | Počet remíz |
| session_token | VARCHAR(64) | Token pre single-session enforcement |
| created_at | DATETIME | Dátum vytvorenia účtu |

**lobby_messages** — správy z lobby chatu:
| Stĺpec | Typ | Popis |
|---|---|---|
| id | INT AUTO_INCREMENT PK | ID správy |
| username | VARCHAR(50) | Meno odosielateľa |
| message | VARCHAR(500) | Text správy |
| created_at | DATETIME | Čas odoslania |

**global_stats** — globálne štatistiky (1 riadok):
| Stĺpec | Typ | Popis |
|---|---|---|
| id | INT PK (vždy 1) | Fixné ID |
| total_games | INT | Celkový počet odohraných hier |

---

## Funkcie implementované nad rámec zadania

- **Autentifikačný systém** — registrácia, prihlásenie, guest účet, odhlásenie (PHP session + MySQL)
- **Leaderboard** — top 5 hráčov podľa výhier s percentom úspešnosti
- **Osobné štatistiky** — počet hier, výhier, prehier, remíz, úspešnosť (%)
- **Lobby chat** — chat v menu obrazovke s HTTP pollingom (3s interval), 5s cooldown, admin /clear
- **Admin panel** — editovanie štatistík hráčov, globálneho počtu hier (len pre is_admin = 1)
- **Single-session enforcement** — prihlásenie z nového zariadenia odhlási staré (session_token)
- **Chat** — textová komunikácia medzi hráčmi v reálnom čase
- **Herný log** — automatické zaznamenávanie udalostí (ťahy, výstrely, kolízie, odrazy od stien)
- **Prepínanie jazyka** — SK / EN (kompletný preklad celého UI)
- **Prepínanie témy** — tmavá / svetlá
- **Výber obtiažnosti** — ľahká (s navigačnou šípkou) / ťažká (len čiara a percento sily)
- **Oddelené lobby** — separátne fronty pre ľahký a ťažký mód. Na menu sa pri každom tlačidle obtiažnosti zobrazuje počet čakajúcich hráčov (0/2 alebo 1/2). V lobby sa zobrazuje aktuálny stav (1/2 — Čakanie na súpera…)
- **Synchronizácia výstrelov** — server čaká kým OBAJA hráči dokončia simuláciu fyziky pred povolením ďalšieho ťahu (rieši problém rôzne rýchlych počítačov)
- **Indikátor online hráčov** — zelená bodka s počtom pripojených hráčov (v menu aj v chat headeri). Pasívne WS spojenie zabezpečuje aktuálny počet aj na menu obrazovke pred pripojením do hry
- **Pinch-to-zoom** — na mobilných zariadeniach je možné priblížiť/oddialiť hraciu plochu dvoma prstami
- **Číslovanie kameňov** — na plátne aj v logu
- **Detekcia kolízií** — správne poradie (útočník/cieľ) v logu
- **Mobilné zariadenia** — otočenie telefónu upozornenie (portrait → landscape), debounced resize pri zmene orientácie
- **Vlastná 404 stránka** — v dizajne hry
- **Spektátorský mód** — keď je hra plná (2 hráči), ďalší hráč sa môže pripojiť ako divák. Vidí hru v reálnom čase a môže písať do chatu (označené „Spectator meno:", fialová farba). Divák má rate-limit 1 správa za 5 sekúnd.
- **Cheat kód `/cheats` a `/cheatss`** — ak hráč (nie divák) napíše `/cheats` do chatu, jeho kamene sa zväčšia (CHEAT_SCALE = 2.3). Príkaz `/cheatss` vráti kamene na pôvodnú veľkosť. Toggle je možný kedykoľvek. Efekt sa prejaví fyzikálne aj vizuálne na všetkých klientoch vrátane divákov.
