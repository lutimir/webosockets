# WebSocket Flows — Vizuálne sekvenčné diagramy

Tento súbor obsahuje **všetky WebSocket toky** v hre Curling Online.
Každý diagram ukazuje presne aké správy sa posielajú medzi klientom a serverom.

---

## 1. Pripojenie a matchmaking (dvaja hráči sa spárujú)

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
│  (prehliadač)    │        │   (Node.js)      │        │  (prehliadač)    │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Klikne "Hrať"                │                           │
       new WebSocket(url)            │                           │
         │                           │                           │
    2.   │── HTTP Upgrade ─────────>│                           │
         │<── 101 Switching ────────│  WS spojenie otvorené     │
         │                           │  connectedCount++         │
         │                           │                           │
    3.   │── {join, name:"Jano",   >│                           │
         │    difficulty:"easy",    │                           │
         │    userId: 5}            │                           │
         │                           │                           │
         │                    4. Nikto nečaká v easy lobby       │
         │                       waitingPlayers.easy = ws1      │
         │                           │                           │
    5.   │<── {waiting} ────────────│                           │
         │                           │                           │
         │    ┌──────────────────────────────────────────┐      │
         │    │  HRÁČ 1 ČAKÁ V LOBBY (obrazovka 1/2)    │      │
         │    └──────────────────────────────────────────┘      │
         │                           │                           │
         │                    6.     │<── HTTP Upgrade ─────────│
         │                           │── 101 Switching ────────>│
         │                           │  connectedCount++         │
         │                           │                           │
         │                    7.     │<── {join, name:"Fero",  ─│
         │                           │     difficulty:"easy",   │
         │                           │     userId: 8}           │
         │                           │                           │
         │                    8. waitingPlayers.easy existuje!   │
         │                       → PÁROVANIE                    │
         │                       config = loadConfig()          │
         │                       room = { players: [ws1, ws2],  │
         │                                currentTurn: 1,       │
         │                                stonesLeft: {1:5,2:5}}│
         │                       rooms.set("room_1", room)      │
         │                       waitingPlayers.easy = null      │
         │                           │                           │
    9.   │<── {game_start,         ─│── {game_start,           >│  9.
         │     player: 1,           │     player: 2,            │
         │     opponent: "Fero",    │     opponent: "Jano",     │
         │     opponentUserId: 8,   │     opponentUserId: 5,    │
         │     config: {...}}       │     config: {...}}        │
         │                           │                           │
   10.   │<── {turn,               ─│── {turn,                 >│  10.
         │     currentPlayer: 1,    │     currentPlayer: 1,     │
         │     stonesLeft:{1:5,2:5}}│     stonesLeft:{1:5,2:5}} │
         │                           │                           │
    11. initPhysics()               │         11. initPhysics()
        showScreen('game')           │             showScreen('game')
        setupCanvas()                │             setupCanvas()
        "Tvoj ťah" ✓                │             "Ťah súpera" ⏳
```

---

## 2. Kompletný tok jedného výstrelu

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
│  (prehliadač)    │        │   (Node.js)      │        │  (prehliadač)    │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Hráč ťahá myšou              │                           │
       (mousedown → mousemove)       │                           │
       Kreslia sa čiary + šípka      │                           │
         │                           │                           │
    2. Pustí myš (mouseup)           │                           │
       force = dist / MAX_DRAG       │                           │
       angle = atan2(-dy, -dx)       │                           │
       vx = cos(angle) * speed       │                           │
       vy = sin(angle) * speed       │                           │
         │                           │                           │
    3.   │── {shoot, vx, vy} ──────>│                           │
         │                           │                           │
         │                    4. Validácia:                      │
         │                       - Je na ťahu? ✓                │
         │                       - Nie je pauza? ✓              │
         │                       - stonesLeft > 0? ✓            │
         │                       → stonesLeft[1]--              │
         │                       → shotInProgress = true        │
         │                       → shotHistory.push({vx,vy,p:1})│
         │                           │                           │
    5.   │<── {shoot, vx, vy, p:1} ─│── {shoot, vx, vy, p:1} ─>│  5.
         │                           │                           │
    6. Vytvorí Matter.js body       │         6. Vytvorí Matter.js body
       Bodies.circle(x, y, r)        │            Bodies.circle(x, y, r)
       Body.setVelocity(vx, vy)      │            Body.setVelocity(vx, vy)
       World.add(engine.world, body) │            World.add(engine.world, body)
         │                           │                           │
    7. Simulácia beží (60 FPS)      │         7. Simulácia beží (60 FPS)
       ┌─────────────────────┐       │         ┌─────────────────────┐
       │ Engine.update()     │       │         │ Engine.update()     │
       │ Kolízie s kameňmi   │       │         │ Kolízie s kameňmi   │
       │ Odrazy od stien     │       │         │ Odrazy od stien     │
       │ Trenie spomaľuje    │       │         │ Trenie spomaľuje    │
       │ checkStopped()      │       │         │ checkStopped()      │
       └─────────────────────┘       │         └─────────────────────┘
         │                           │                           │
    8. Všetky kamene < 0.12 px/f    │         8. Všetky kamene < 0.12 px/f
       po dobu 45 framov             │            po dobu 45 framov
       → zastavenie (velocity=0)     │            → zastavenie (velocity=0)
         │                           │                           │
    9.   │── {stones_stopped,  ────>│                           │
         │    positions: [...]}      │                           │
         │                           │                           │
         │                   10. stoppedBy.add(1)               │
         │                       size=1 < 2 → čakám...          │
         │                           │                           │
         │                           │<── {stones_stopped,  ────│  9.
         │                           │     positions: [...]}    │
         │                           │                           │
         │                   10. stoppedBy.add(2)               │
         │                       size=2 ≥ 2 → OBAJA STOP!      │
         │                       stoppedBy.clear()              │
         │                       shotInProgress = false         │
         │                       currentTurn = 2                │
         │                           │                           │
   11.   │<── {turn, player:2,    ──│── {turn, player:2,      >│  11.
         │     stonesLeft:{1:4,2:5}}│     stonesLeft:{1:4,2:5}} │
         │                           │                           │
    12. isMyTurn = false            │        12. isMyTurn = true
        showPhantom = false          │            showPhantom = true
        "Ťah súpera" ⏳             │            "Tvoj ťah" ✓
```

---

## 3. Koniec hry (game over)

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    Posledný kameň bol vystrelený   │    Posledný kameň vystrelený
    (stonesLeft oboch = 0)           │                           │
         │                           │                           │
    1.   │── {stones_stopped,  ────>│                           │
         │    positions: [          │                           │
         │      {p:1, x:301, y:152},│                           │
         │      {p:2, x:295, y:148},│                           │
         │      ...                 │                           │
         │    ]}                    │                           │
         │                           │<── {stones_stopped} ─────│  1.
         │                           │                           │
         │                    2. stonesLeft[1]=0 && [2]=0        │
         │                       → KONIEC HRY!                  │
         │                           │                           │
         │                    3. Výpočet vzdialeností:           │
         │                       pre každý kameň:               │
         │                       dist = √((x-cieľ.x)²          │
         │                              + (y-cieľ.y)²)          │
         │                           │                           │
         │                       Hráč 1: najbližší = 12 px      │
         │                       Hráč 2: najbližší = 45 px      │
         │                       → VÍŤAZ = hráč 1               │
         │                           │                           │
    4.   │<── {game_over,          ─│── {game_over,            >│  4.
         │     winner: 1,           │     winner: 1,            │
         │     distances:{1:12,2:45}│     distances:{1:12,2:45} │
         │     player1UserId: 5,    │     player1UserId: 5,     │
         │     player2UserId: 8}    │     player2UserId: 8}     │
         │                           │                           │
    5. gameOver = true              │         5. gameOver = true
       overlay "Vyhral si!"         │            overlay "Prehral si!"
         │                           │                           │
    6. Len hráč 1 zapisuje výsledok:│                           │
       │                             │                           │
       │── POST /api/stats.php ────────────────────────────────>│
       │   {winner_id:5,            │              PHP API      │
       │    loser_id:8,             │              MySQL:       │
       │    is_draw:false}          │              winner +1 win│
       │                             │              loser +1 loss│
       │<── {ok: true} ────────────────────────────────────────│
       │                             │                           │
    7. fetchLeaderboard()           │         7. fetchLeaderboard()
       (po 1.5s oneskorení)          │            (po 1.5s oneskorení)
```

### Prečo len hráč 1 zapisuje?
```
    Keby obaja poslali POST:
    
    HRÁČ 1 ── POST {winner:5, loser:8} ──> PHP → MySQL: zapas #1 ✓
    HRÁČ 2 ── POST {winner:5, loser:8} ──> PHP → MySQL: zapas #2 ✗ DUPLIKÁT!
    
    Riešenie: if (this.playerNumber === 1) → recordGameResult()
```

---

## 4. Odpojenie súpera (opponent disconnected)

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
         │                           │                      1. Zavrie tab /
         │                           │                         stratí internet
         │                           │                           │
         │                           │<── ws.close ─────────────│
         │                           │                           │
         │                    2. ws.on('close') handler:         │
         │                       connectedCount--                │
         │                       broadcastOnlineCount()          │
         │                           │                           │
         │                    3. Kontrola: hral ≥ 2 kamene?     │
         │                       áno → disconnectWinner = 1     │
         │                              (hráč 1 vyhráva)        │
         │                       nie → disconnectWinner = 0     │
         │                              (nedostatok ťahov)      │
         │                           │                           │
    4.   │<── {opponent_disconnected,│                           │
         │     winner: 1,           │                           │
         │     player1UserId: 5,    │                           │
         │     player2UserId: 8}    │                           │
         │                           │                           │
    5. gameOver = true              │                           │
       overlay "Súper sa odpojil"    │                           │
       recordGameResult()            │                           │
         │                           │                           │
         │                    6. rooms.delete("room_1")         │
         │                       broadcastLobbyStatus()         │
         │                       (slot sa uvoľnil: 0/2)         │
         │                           │                           │
    7. Klikne "OK"                  │                           │
       → menu obrazovka              │                           │
```

---

## 5. Spectator (divák) sa pripojí

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐
│    HRÁČ 1        │  │     SERVER       │  │    HRÁČ 2        │  │   DIVÁK      │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘
         │                     │                     │                    │
    Hra prebieha (2/2)         │                     │                    │
         │                     │                     │               1. Klikne
         │                     │                     │                  "Sledovať"
         │                     │                     │                    │
         │                     │<── {join, name:"Eva", ──────────────────│
         │                     │     difficulty:"easy"}                  │
         │                     │                     │                    │
         │              2. waitingPlayers.easy = null│                    │
         │                 ALE findActiveRoom("easy")│                    │
         │                 → room existuje!          │                    │
         │                 → ws.isSpectator = true   │                    │
         │                 → room.spectators.push(ws)│                    │
         │                     │                     │                    │
         │                     │── {spectate,       ────────────────────>│  3.
         │                     │    config: {...},   │                    │
         │                     │    currentTurn: 2,  │                    │
         │                     │    stonesLeft: ..., │                    │
         │                     │    player1: "Jano", │                    │
         │                     │    player2: "Fero", │                    │
         │                     │    shotHistory: [   │                    │
         │                     │      {vx,vy,p:1},  │                    │
         │                     │      {vx,vy,p:2},  │                    │
         │                     │      ...            │                    │
         │                     │    ]}               │                    │
         │                     │                     │                    │
         │                     │                     │               4. initPhysics()
         │                     │                     │                  replayShot() ×N
         │                     │                     │                  runReplaySimulation()
         │                     │                     │                  → vidí kamene na
         │                     │                     │                    finálnych pozíciách
         │                     │                     │                    │
    5.   │<── {spectate_event, ┤── {spectate_event, >│── {spectate_event,>│  5.
         │     name:"Eva",     │    name:"Eva",      │    name:"Eva",     │
         │     action:"joined"}│    action:"joined"} │    action:"joined"}│
         │                     │                     │                    │
    6. Chat: "Eva sa           │    6. Chat: "Eva sa │               6. Chat: "Sledujete
       pripojil ako divák."    │       pripojil..."  │                  hru ako divák"
         │                     │                     │                    │
    ┌────┴─────────────────────┴─────────────────────┴────────────────────┤
    │                   OD TERAZ DIVÁK DOSTÁVA VŠETKO:                    │
    │   shoot, turn, chat, cheat, paused, resumed, game_over              │
    │   (cez broadcastAll = hráčom + divákom)                             │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Pauza a pokračovanie

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
│  (na ťahu)       │        │                  │        │  (čaká)          │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Klikne "Pauza"               │                           │
         │                           │                           │
    2.   │── {pause} ──────────────>│                           │
         │                           │                           │
         │                    3. Validácia:                      │
         │                       - Je na ťahu? ✓ (len on môže)  │
         │                       - Nie je pauza? ✓              │
         │                       → room.paused = true           │
         │                           │                           │
    4.   │<── {paused, by: 1} ──────│── {paused, by: 1} ──────>│  4.
         │                           │                           │
    5. Overlay "PAUZA"              │         5. Overlay "PAUZA"
       Tlačidlo "Pokračovať"        │            Tlačidlo "Pokračovať"
       HUD: "Pauza"                 │            HUD: "Pauza"
         │                           │                           │
         ~~~~~ čas plynie ~~~~~      │         ~~~~~ čas plynie ~~~~~~
         │                           │                           │
    6. HOCIKTO klikne "Pokračovať" │                           │
       (tu: hráč 2)                  │                           │
         │                           │                           │
         │                           │<── {resume} ─────────────│  6.
         │                           │                           │
         │                    7. room.paused = false            │
         │                           │                           │
    8.   │<── {resumed} ────────────│── {resumed} ─────────────>│  8.
         │                           │                           │
    9. Overlay zmizne               │         9. Overlay zmizne
       Hra pokračuje                 │            Hra pokračuje
```

---

## 7. Reštart hry (žiadosť + súhlas)

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Klikne "Reštart"             │                           │
         │                           │                           │
    2.   │── {restart_request} ────>│                           │
         │                           │                           │
         │                    3. restartRequestedBy = 1         │
         │                           │                           │
         │                           │── {restart_request} ────>│  4.
         │                           │                           │
         │                           │         5. Overlay "Súper žiada
         │                           │            o reštart hry."
         │                           │            [Súhlasiť] [Odmietnuť]
         │                           │                           │
         │     ┌─────────────────────────────────┐               │
         │     │  SCENÁR A: Hráč 2 SÚHLASÍ       │               │
         │     └─────────────────────────────────┘               │
         │                           │                           │
         │                           │<── {restart_accept} ─────│  6a.
         │                           │                           │
         │                    7a. Reset room:                    │
         │                        currentTurn = 1                │
         │                        stonesLeft = {1:5, 2:5}        │
         │                        cheatsActive.clear()           │
         │                        shotHistory = []               │
         │                        gameOver = false               │
         │                           │                           │
    8a.  │<── {restart, config} ────│── {restart, config} ─────>│  8a.
         │                           │                           │
    9a.  │<── {turn, player:1} ─────│── {turn, player:1} ──────>│  9a.
         │                           │                           │
   10a. resetGame()                 │        10a. resetGame()
        initPhysics()                │             initPhysics()
        "Hra reštartovaná!"          │             "Hra reštartovaná!"
         │                           │                           │
         │     ┌─────────────────────────────────┐               │
         │     │  SCENÁR B: Hráč 2 ODMIETNE      │               │
         │     └─────────────────────────────────┘               │
         │                           │                           │
         │                           │<── {restart_decline} ────│  6b.
         │                           │                           │
         │                    7b. restartRequestedBy = null      │
         │                           │                           │
    8b.  │<── {restart_declined} ───│                           │
         │                           │                           │
    9b. notify("Súper odmietol")    │                           │
```

---

## 8. Chat medzi hráčmi

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Napíše "gg" + Enter          │                           │
         │                           │                           │
    2.   │── {chat, text:"gg"} ────>│                           │
         │                           │                           │
         │                    3. text.substring(0, 200)         │
         │                       (max 200 znakov, anti-XSS)     │
         │                           │                           │
    4.   │<── {chat,               ─│── {chat,                 >│  4.
         │     player: 1,           │     player: 1,            │
         │     name: "Jano",        │     name: "Jano",         │
         │     text: "gg"}          │     text: "gg"}           │
         │                           │                           │
    5. Zobrazí:                     │         5. Zobrazí:
       "Jano: gg" (červená)          │            "Jano: gg" (červená)
```

### Chat od diváka (s rate limitom):
```
┌──────────────────┐        ┌──────────────────┐
│    DIVÁK         │        │     SERVER       │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
    1.   │── {spectate_chat,       >│
         │    text:"super hra"}     │
         │                           │
         │                    2. Rate limit check:
         │                       lastChatTime? < 5000ms?
         │                           │
         │   ┌── AK LIMIT NEPREKROČENÝ ──────────────────┐
         │   │                                            │
         │   │  3. broadcastAll:                          │
         │   │     {chat, player:0, name:"Eva",           │
         │   │      text:"super hra", spectator:true}     │
         │   │                                            │
         │   │  Hráči vidia: "Spectator Eva: super hra"   │
         │   │  (fialová farba)                           │
         │   └────────────────────────────────────────────┘
         │                           │
         │   ┌── AK LIMIT PREKROČENÝ ────────────────────┐
         │   │                                            │
         │   │  3. send: {chat_ratelimit, msLeft: 3200}   │
         │   │     "Počkaj 5 sekúnd"                      │
         │   └────────────────────────────────────────────┘
```

---

## 9. Cheat aktivácia (/cheats)

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    HRÁČ 1        │        │     SERVER       │        │    HRÁČ 2        │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
    1. Napíše "/cheats" do chatu    │                           │
         │                           │                           │
    2.   │── {chat, text:"/cheats"}>│                           │
         │                           │                           │
         │                    3. Detekcia cheat príkazu:         │
         │                       text === "/cheats"?             │
         │                       → cheatsActive.add(1)           │
         │                       → NEZOBRAZÍ SA V CHATE!        │
         │                           │                           │
    4.   │<── {cheat,              ─│── {cheat,                >│  4.
         │     player: 1,           │     player: 1,            │
         │     revert: false}       │     revert: false}        │
         │                           │                           │
    5. cheatScale[1] = 2.3          │         5. cheatScale[1] = 2.3
       Matter.Body.scale(×2.3)       │            Matter.Body.scale(×2.3)
       Chat: "Jano aktivoval cheaty! │            Chat: "Jano aktivoval
              Kamene sú o 130%       │                   cheaty! Kamene sú
              väčšie."               │                   o 130% väčšie."
         │                           │                           │
   ───── NESKORŠIE: Hráč napíše "/cheatss" ──────────────────────
         │                           │                           │
    6.   │── {chat,text:"/cheatss"}>│                           │
         │                           │                           │
         │                    7. cheatsActive.delete(1)          │
         │                           │                           │
    8.   │<── {cheat,              ─│── {cheat,                >│  8.
         │     player: 1,           │     player: 1,            │
         │     revert: true}        │     revert: true}         │
         │                           │                           │
    9. cheatScale[1] = 1.0          │         9. cheatScale[1] = 1.0
       Matter.Body.scale(×0.43)      │            Matter.Body.scale(×0.43)
       Chat: "Jano deaktivoval       │            Chat: "Jano deaktivoval
              cheaty."               │                   cheaty."
```

---

## 10. Online počítadlo (pasívne WS)

```
┌──────────────────┐        ┌──────────────────┐
│ KLIENT (menu)    │        │     SERVER       │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
    1. Stránka sa načíta             │
       CurlingGame()                 │
       connectStatusWs()             │
         │                           │
    2.   │── new WebSocket(url) ───>│
         │<── 101 Switching ────────│
         │                           │  connectedCount++ (napr. 5)
         │                           │
    3.   │<── {online_count,       ─│── broadcast všetkým ─────>
         │     count: 5}            │
         │                           │
    4.   │<── {lobby_status,       ─│
         │     lobbies: {           │
         │       easy: 1,           │  (1 hráč čaká v easy)
         │       hard: 0            │  (nikto nečaká v hard)
         │     }}                   │
         │                           │
    5. Zobrazí:                     │
       🟢 5 online                   │
       Easy [1/2]  Hard [0/2]       │
         │                           │
    ───── Hráč klikne "Hrať" ──────────
         │                           │
    6. disconnectStatusWs()         │  ← zatvorí PASÍVNE WS
       connect("Jano")              │  ← otvorí HLAVNÉ WS
         │                           │
    7.   │── new WebSocket(url) ───>│  hlavné WS preberá
         │── {join, ...} ─────────>│  online_count správy
```

---

## 11. Lobby status broadcast

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐
│ KLIENT A (menu)  │   │     SERVER       │   │ KLIENT B (menu)  │   │ KLIENT C     │
│                  │   │                  │   │                  │   │ (v hre)      │
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘   └──────┬───────┘
         │                      │                      │                     │
         │               1. Hráč D klikne "Hrať"      │                     │
         │                  handleJoin() →              │                     │
         │                  waitingPlayers.easy = wsD   │                     │
         │                      │                      │                     │
    2.   │<── {lobby_status,   ─│── {lobby_status,    >│── {lobby_status,  >│  2.
         │     lobbies: {       │     lobbies: {        │     lobbies: {      │
         │       easy: 1,       │       easy: 1,        │       easy: 1,      │
         │       hard: 0}}      │       hard: 0}}       │       hard: 0}}     │
         │                      │                      │                     │
    3. Easy: [1/2]             │         3. Easy: [1/2]│              3. (ignoruje)
       "Hrať" tlačidlo viditeľné│            viditeľné  │                     │
         │                      │                      │                     │
         │               4. Hráč E klikne "Hrať" (easy)│                     │
         │                  → PÁROVANIE D + E           │                     │
         │                  waitingPlayers.easy = null  │                     │
         │                      │                      │                     │
    5.   │<── {lobby_status,   ─│── {lobby_status,    >│                     │
         │     lobbies: {       │     lobbies: {        │                     │
         │       easy: 2,       │       easy: 2,        │                     │
         │       hard: 0}}      │       hard: 0}}       │                     │
         │                      │                      │                     │
    6. Easy: [2/2]             │         6. Easy: [2/2]│                     │
       "Hrať" SKRYTÉ            │            "Hrať" SKRYTÉ                    │
       "Sledovať" ZOBRAZENÉ     │            "Sledovať" ZOBRAZENÉ            │
```

---

## 12. Celý životný cyklus spojenia

```
    HRÁČ OTVORÍ STRÁNKU
           │
           ▼
    ┌─────────────────────┐
    │  connectStatusWs()  │◄──── PASÍVNE WS (len online_count + lobby_status)
    │  checkSession()     │◄──── HTTP GET /api/auth.php?action=me
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────┐
    │  AUTH OBRAZOVKA      │     HTTP POST /api/auth.php
    │  login / register /  │     ?action=login | register | guest
    │  guest               │
    └──────────┬──────────┘
               │ onAuthSuccess()
               ▼
    ┌─────────────────────┐
    │  MENU OBRAZOVKA      │     ← startLobbyChat() (HTTP polling 3s)
    │  Leaderboard +       │     ← fetchLeaderboard() (HTTP GET)
    │  Lobby chat +        │     ← statusWs počúva lobby_status
    │  Online počítadlo    │
    └──────────┬──────────┘
               │ Klikne "Hrať"
               ▼
    ┌─────────────────────┐
    │  disconnectStatusWs()│     ← zatvorí pasívne WS
    │  connect(name)       │     ← otvorí HLAVNÉ WS
    │  → {join}            │
    └──────────┬──────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    ┌────────┐   ┌──────────┐
    │ LOBBY  │   │ SPECTATE │     (ak hra prebieha → divák)
    │ {wait} │   │ {spectate│
    └───┬────┘   │  + hist} │
        │        └──────────┘
        │ Páruj s 2. hráčom
        ▼
    ┌─────────────────────┐
    │  HRA PREBIEHA        │     WS: shoot, turn, chat, pause,
    │  {game_start}        │          resume, cheat, stones_stopped
    │  initPhysics()       │     HTTP: recordGameResult (koniec hry)
    │  setupCanvas()       │           fetchLeaderboard (koniec hry)
    └──────────┬──────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    ┌────────┐   ┌──────────────┐
    │GAME    │   │ OPPONENT     │
    │OVER    │   │ DISCONNECTED │
    │{game_  │   │ {opponent_   │
    │ over}  │   │  disconnected│
    └───┬────┘   └──────┬───────┘
        │               │
        └───────┬───────┘
                │ recordGameResult() + fetchLeaderboard()
                ▼
    ┌─────────────────────┐
    │  MENU (návrat)       │     ← connectStatusWs() (obnoví pasívne WS)
    │  stopLobbyChat()     │     ← startLobbyChat()
    │  startLobbyChat()    │     ← fetchLeaderboard()
    └─────────────────────┘
```

---

## Prehľad: Ktoré správy idú komu?

```
    ┌──────────────────────────────────────────────────────────────────┐
    │                  KTO DOSTÁVA SPRÁVU?                             │
    ├──────────────────────┬──────────────┬───────────┬───────────────┤
    │  Správa               │ Oba hráči   │ + Diváci  │ Všetci na WS  │
    ├──────────────────────┼──────────────┼───────────┼───────────────┤
    │  game_start           │      ✓      │           │               │
    │  shoot                │              │     ✓     │               │
    │  turn                 │              │     ✓     │               │
    │  paused / resumed     │              │     ✓     │               │
    │  restart              │              │     ✓     │               │
    │  game_over            │              │     ✓     │               │
    │  chat                 │              │     ✓     │               │
    │  cheat                │              │     ✓     │               │
    │  spectate_event       │              │     ✓     │               │
    │  restart_request      │ len súper    │           │               │
    │  restart_declined     │ len žiadateľ │           │               │
    │  online_count         │              │           │      ✓        │
    │  lobby_status         │              │           │      ✓        │
    │  waiting              │ len čakajúci │           │               │
    │  spectate             │              │ len nový  │               │
    │  chat_ratelimit       │              │ len divák │               │
    │  opponent_disconnected│ len zostávaj.│ + diváci  │               │
    └──────────────────────┴──────────────┴───────────┴───────────────┘

    Funkcie v server.js:
    ─────────────────────
    send(ws, data)         → 1 klient
    broadcast(room, data)  → 2 hráči v room
    broadcastAll(room, data) → 2 hráči + N divákov v room
    broadcastOnlineCount() → VŠETCI pripojení na WS server
    broadcastLobbyStatus() → VŠETCI pripojení na WS server
```
