// ===========================================================================
// CURLING WEBSOCKET SERVER
// ===========================================================================
// Tento subor je WebSocket server pre online curling hru.
// Server sluzi ako AUTORITA nad stavom hry — riadi striedanie hracov,
// validuje tahy a odosiela herne udalosti obom hracom.
//
// *** AKO WEBSOCKET FUNGUJE ***
// 1. Klient (prehliadac) posle HTTP poziadavku s hlavickou "Upgrade: websocket"
// 2. Server odpovie "101 Switching Protocols" — spojenie sa prepne na WebSocket
// 3. Od tejto chvile je medzi klientom a serverom TRVALE obojsmerne spojenie
// 4. Klient aj server mozu posielat spravy KEDYKOLVEK bez novych HTTP poziadaviek
// 5. Spravy su serializovane do JSON formatu (text)
//
// *** ARCHITEKTURA ***
// - Kazdy klient sa pripoji na server cez WebSocket
// - Server paruje dvoch cakajucich hracov do "room" (hernej miestnosti)
// - Kazda room ma stav (kto je na tahu, kolko kamenov zostava, ci je pauza...)
// - Klient posiela: join, shoot (vektor vystrelu), stones_stopped, pause, resume,
//   restart_request, restart_accept, restart_decline, chat
// - Server posiela: waiting, game_start, turn, shoot, paused, resumed, restart,
//   restart_declined, game_over, opponent_disconnected, chat
// ===========================================================================

// Nacitanie kniznice 'ws' — tato kniznica implementuje WebSocket protokol pre Node.js
// Na strane klienta (prehliadac) je WebSocket nativny, ale Node.js ho nema vstavaný
// preto potrebujeme tuto kniznicu
const WebSocket = require('ws');

// 'fs' (filesystem) — vstavaný Node.js modul na pracu so subormi
// Pouzivame ho na citanie config.json
const fs = require('fs');

// 'path' — vstavaný Node.js modul na pracu s cestami k suborom
// __dirname + 'config.json' = absolutna cesta ku konfiguraku
const path = require('path');

// 'http' — vstavaný Node.js modul na HTTP poziadavky
// Pouzivame ho na volanie PHP API na zaznamenanie vysledkov hier
const http = require('http');

// ===========================================================================
// KONFIGURÁCIA
// ===========================================================================
// Funkcia loadConfig() nacita config.json zo suboroveho systemu.
// Vola sa pri KAZDOM vytvoreni novej hernej miestnosti — to umoznuje
// "hot-reload" — zmeníš config.json a nova hra uz pouzije nove hodnoty
// BEZ RESTARTU SERVERA.
function loadConfig() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}

// Pociatocne nacitanie configu
let config = loadConfig();

// Port na ktorom server pocuva — defaultne 3000, mozno zmenit cez env premennu
const PORT = process.env.WS_PORT || 3000;

// Vytvorenie WebSocket servera na danom porte
// Toto je ekvivalent "new WebSocket.Server({ port: 3000 })" z tutorialu
// Server zacne pocuvat na porte a cakat na prichadzajuce WebSocket spojenia
const wss = new WebSocket.Server({ port: PORT });

// ===========================================================================
// STAV SERVERA — GLOBALNE PREMENNE
// ===========================================================================

// ===========================================================================
// LOBBY SYSTEM — oddelene fronty pre kazdu obtiaznost
// ===========================================================================
// Hra ma 2 mody: 'easy' (s navigacnou sipkou) a 'hard' (bez navigacie).
// Kazdy mod ma vlastne lobby — hraci su parovani LEN v ramci rovnakej obtiaznosti.
// waitingPlayers.easy = WebSocket hraca ktory caka v easy lobby (alebo null)
// waitingPlayers.hard = WebSocket hraca ktory caka v hard lobby (alebo null)
const waitingPlayers = { easy: null, hard: null };

// Ziskanie aktualneho stavu lobby — kolko hracov caka v kazdom mode
// Vracia: 0 = prazdne, 1 = jeden caka, 2 = hra prebieha (moznost spectate)
// Vyuziva sa pri broadcastovani lobby_status vsetkym klientom
function getLobbyStatus() {
    return {
        easy: waitingPlayers.easy ? 1 : (findActiveRoom('easy') ? 2 : 0),
        hard: waitingPlayers.hard ? 1 : (findActiveRoom('hard') ? 2 : 0)
    };
}

// Broadcast stavu lobby vsetkym pripojenym klientom
// Vola sa pri kazdom join/disconnect ktory meni pocet cakajucich hracov
// Klienti pouzivaju tieto data na zobrazenie "1/2" alebo "0/2" v menu
function broadcastLobbyStatus() {
    const data = JSON.stringify({ type: 'lobby_status', lobbies: getLobbyStatus() });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// rooms — Map (slovnik) vsetkych aktivnych hernych miestnosti
// Kluc je roomId (napr. "room_1"), hodnota je objekt s celym stavom hry
const rooms = new Map();

// Pocitadlo pre generovanie unikatnych ID miestnosti
let roomIdCounter = 0;

// ===========================================================================
// ONLINE POCITADLO — sledovanie poctu pripojenych klientov
// ===========================================================================
// Kazdy pripojeny WebSocket klient zvysi connectedCount.
// Pri odpojeni sa znizi. Hodnota sa posiela vsetkym klientom
// pri zmene (connect/disconnect), aby mohli zobrazit indikator.
let connectedCount = 0;

// Broadcast aktualneho poctu pripojenych hracov vsetkym klientom
// Vola sa pri kazdom pripojeni aj odpojeni
function broadcastOnlineCount() {
    const data = JSON.stringify({ type: 'online_count', count: connectedCount });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// ===========================================================================
// POMOCNE FUNKCIE
// ===========================================================================

// Bezpecne odoslanie spravy klientovi
// Pred odoslanim skontroluje ci je spojenie OPEN (aktivne)
// Vsetky spravy sa serializuju do JSON — klient ich potom parsuje cez JSON.parse()
function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Najdenie hernej miestnosti pre daneho hraca
// Kazdy ws objekt ma pridruzeny ws.roomId — podla neho vyhladame room v Map
function getRoom(ws) {
    if (!ws.roomId) return null;
    return rooms.get(ws.roomId);
}

// Najdenie supera v hernej miestnosti
// Room ma pole players s dvoma prvkami — vrati toho druheho
function getOpponent(ws) {
    const room = getRoom(ws);
    if (!room) return null;
    return room.players.find(p => p !== ws);
}

// Odoslanie spravy VSETKYM hracom v miestnosti (broadcast)
// Pouziva sa ked obaja hraci musia dostat rovnaku informaciu
// (napr. shoot, turn, game_over)
function broadcast(room, data) {
    room.players.forEach(p => send(p, data));
}

// Odoslanie spravy VSETKYM v miestnosti — hracom AJ divakom
// Pouziva sa pre herné udalosti ktore maju vidiet aj divaci (shoot, turn, chat, cheat, game_over...)
function broadcastAll(room, data) {
    room.players.forEach(p => send(p, data));
    (room.spectators || []).forEach(s => send(s, data));
}

// Najdenie aktivnej (prebiehajucej) hernej miestnosti podla obtiaznosti.
// Vracia prvu aktivnu room pre danu difficulty, alebo null ak ziadna neexistuje.
// Pouziva sa na priradenie divakov — ked sa hrac chce pripojit ale hra uz prebieha.
function findActiveRoom(difficulty) {
    for (const [id, room] of rooms) {
        if (room.difficulty === difficulty && !room.gameOver) return room;
    }
    return null;
}

// ===========================================================================
// HLAVNA UDALOST — NOVE PRIPOJENIE KLIENTA
// ===========================================================================
// wss.on('connection') sa zavola ZAKAZDYM ked sa novy klient pripoji na server.
// Parameter 'ws' je WebSocket objekt reprezentujuci spojenie s jednym klientom.
// Cez tento objekt je mozne:
//   - ws.send() — poslat spravu klientovi
//   - ws.on('message') — prijimat spravy od klienta
//   - ws.on('close') — reagovat na odpojenie klienta
//   - ws.readyState — zistit stav spojenia
wss.on('connection', (ws) => {
    // Zvysenie poctu pripojenych klientov a broadcast noveho poctu
    connectedCount++;
    console.log('Client connected (online: ' + connectedCount + ')');
    broadcastOnlineCount();

    // Poslanie aktualneho stavu lobby novemu klientovi
    // (aby videl pocet cakajucich hracov hned po pripojeni, nie az pri zmene)
    send(ws, { type: 'lobby_status', lobbies: getLobbyStatus() });

    // Prijem spravy od klienta
    // Kazda sprava je Buffer — prevedieme na string a parsujeme JSON
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            return; // Ak sprava nie je validny JSON, ignorujeme
        }
        handleMessage(ws, msg);
    });

    // Klient sa odpojil (zatvoril prehliadac, stratil internet...)
    ws.on('close', () => {
        // Znizenie poctu pripojenych klientov a broadcast
        connectedCount--;
        console.log('Client disconnected (online: ' + connectedCount + ')');
        broadcastOnlineCount();

        // Ak bol hrac ten co cakal v niektorom lobby — zrusime cakanie
        // a broadcastneme novy stav lobby (znizi sa z 1/2 na 0/2)
        if (waitingPlayers.easy === ws) {
            waitingPlayers.easy = null;
            broadcastLobbyStatus();
            return;
        }
        if (waitingPlayers.hard === ws) {
            waitingPlayers.hard = null;
            broadcastLobbyStatus();
            return;
        }

        // Ak bol divak — oznamime ostatnym a odstranime ho zo zoznamu
        if (ws.isSpectator) {
            const room = getRoom(ws);
            if (room) {
                // Fialova systemova sprava o odchode divaka pre vsetkych v room
                broadcastAll(room, {
                    type: 'spectate_event',
                    name: ws.playerName,
                    action: 'left'
                });
                room.spectators = room.spectators.filter(s => s !== ws);
            }
            return;
        }

        // Ak bol hrac v hernej miestnosti — informujeme supera aj divakov
        const room = getRoom(ws);
        if (room) {
            // Zistenie ci hra mala dostatok tahov na zaznamenanie vysledku
            let disconnectWinner = 0;
            if (!room.gameOver) {
                const totalPlayed = (config.stonesPerPlayer * 2) - (room.stonesLeft[1] || 0) - (room.stonesLeft[2] || 0);
                if (totalPlayed >= 2) {
                    // Hrac ktory zostal vyhra (ten co odisiel prehra)
                    disconnectWinner = ws.playerNumber === 1 ? 2 : 1;
                    room.gameOver = true;
                    console.log('Player ' + ws.playerNumber + ' disconnected mid-game, winner=' + disconnectWinner + ' (stones played: ' + totalPlayed + ')');
                }
            }

            const opponent = getOpponent(ws);
            if (opponent) {
                // Posielame info o hracoch aby klient mohol zaznamenat vysledok
                const pl1 = room.players[0];
                const pl2 = room.players[1];
                send(opponent, {
                    type: 'opponent_disconnected',
                    winner: disconnectWinner,
                    player1UserId: pl1 ? pl1.userId : 0,
                    player2UserId: pl2 ? pl2.userId : 0
                });
                opponent.roomId = null;
            }
            // Divaci tiez dostanu oznamenie — ich hra sa skoncila
            (room.spectators || []).forEach(s => {
                send(s, { type: 'opponent_disconnected' });
                s.roomId = null;
            });
            // Zmazeme hernu miestnost
            rooms.delete(ws.roomId);
            // Updatujeme lobby status — slot 2/2 sa uvolnil
            broadcastLobbyStatus();
        }
    });
});

// ===========================================================================
// ROUTER SPRAV — urcuje aku akciu vykonat podla typu spravy
// ===========================================================================
// Klient posiela JSON s property "type" — podla nej server rozhodne
// co ma spravit. Toto je hlavny "dispatcher" vsetkych hracskych akcii.
function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'join':             // Hrac chce vstupit do hry
            return handleJoin(ws, msg);
        case 'shoot':            // Hrac vystrelil kamen (smer + sila)
            return handleShoot(ws, msg);
        case 'stones_stopped':   // Vsetky kamene sa zastavili — dalsi tah
            return handleStopped(ws, msg);
        case 'pause':            // Hrac chce pozastavit hru
            return handlePause(ws);
        case 'resume':           // Hrac chce pokracovat po pauze
            return handleResume(ws);
        case 'restart_request':  // Hrac ziada o restart
            return handleRestartRequest(ws);
        case 'restart_accept':   // Super suhlasi s restartom
            return handleRestartAccept(ws);
        case 'restart_decline':  // Super odmietol restart
            return handleRestartDecline(ws);
        case 'chat':             // Chatova sprava od hraca
            return handleChat(ws, msg);
        case 'spectate_chat':    // Chatova sprava od divaka (rate-limitovana 1/5s)
            return handleSpectateChat(ws, msg);
    }
}

// ===========================================================================
// HANDLER: JOIN — Prihlasenie hraca a matchmaking (parovanie)
// ===========================================================================
// Ked hrac klikne "Hrat" v menu, klient posle { type: 'join', name: 'Meno' }
// Server ma 2 moznosti:
//   A) Ak NIKTO necaka → hrac sa stane waitingPlayer, dostane { type: 'waiting' }
//   B) Ak UZ NIEKTO CAKA → vytvori sa room, hra zacne pre oboch
//
// Pri vytvoreni room sa znovu nacita config.json (hot-reload) — to znamena
// ze zmena configu sa prejavi pri dalsej novej hre bez restartu servera.
function handleJoin(ws, msg) {
    // Ocistenie a obmedzenie mena na max 20 znakov (prevencia pred XSS/spam)
    const name = String(msg.name || 'Hrac').substring(0, 20);
    ws.playerName = name;
    ws.userId = Number(msg.userId) || 0;  // ID prihlaseneho uzivatela z PHP session

    // Urcenie obtiaznosti z klientovej spravy — default 'easy'
    const difficulty = msg.difficulty === 'hard' ? 'hard' : 'easy';
    ws.difficulty = difficulty;

    // Prevencia duplikacie — ak uz iny WS s rovnakym userId caka alebo hra, zavrieme stare spojenie
    if (ws.userId > 0) {
        // Kontrola cakajucich hracov
        for (const diff of ['easy', 'hard']) {
            if (waitingPlayers[diff] && waitingPlayers[diff] !== ws && waitingPlayers[diff].userId === ws.userId) {
                waitingPlayers[diff].close();
                waitingPlayers[diff] = null;
            }
        }
        // Kontrola aktivnych hier a divakov
        for (const [, room] of rooms) {
            for (const p of room.players) {
                if (p !== ws && p.userId === ws.userId && p.readyState === 1) {
                    p.close();
                }
            }
            for (const s of (room.spectators || [])) {
                if (s !== ws && s.userId === ws.userId && s.readyState === 1) {
                    s.close();
                }
            }
        }
    }

    // Ziskanie cakajuceho hraca z prislusneho lobby (podla obtiaznosti)
    const waiting = waitingPlayers[difficulty];

    // Ak existuje cakajuci hrac V ROVNAKOM MODE a je stale pripojeny → sparujeme
    if (waiting && waiting !== ws && waiting.readyState === WebSocket.OPEN) {
        // Hot-reload konfiguracie — kazda nova hra pouzije aktualny config
        config = loadConfig();

        // Vytvorenie novej hernej miestnosti
        const roomId = 'room_' + (++roomIdCounter);
        const room = {
            id: roomId,
            players: [waiting, ws],         // Pole dvoch WebSocket spojeni
            spectators: [],                  // Divaci ktori sleduju hru (bud sa pridruzili neskor)
            difficulty: difficulty,           // Mod hry (easy/hard)
            currentTurn: 1,                  // Hrac 1 zacina
            stonesLeft: { 1: config.stonesPerPlayer, 2: config.stonesPerPlayer },
            paused: false,                   // Ci je hra pozastavena
            restartRequestedBy: null,        // Kto ziadal restart (null = nikto)
            shotInProgress: false,           // Ci sa prave strela (kamene sa pohybuju)
            gameOver: false,                 // Ci je hra ukoncena
            // ==== SYNCHRONIZACIA STOP ====
            // stoppedBy: Set hracov, ktori uz nahlasili stones_stopped
            // Server caka kym OBAJA hraci nahlásia zastavenie kamenov.
            // Toto riesi problem ze rychlejsi pocitac dokonci simulaciu skor
            // a hrac by mohol strielat kym super este vidi pohybujuce sa kamene.
            stoppedBy: new Set(),
            // ==== CHEAT SYSTEM ====
            // cheatsActive: Set hracov ktori maju momentalne aktivny cheat (/cheats = zap, /cheatss = vyp).
            // Kazdy hrac moze togglovat cheat kedy chce. Reset pri restarte.
            cheatsActive: new Set(),
            // ==== HISTORIA VYSTROLOV PRE DIVAKOV ====
            // Uklada vsetky vystroly (vx, vy, player) aby novy divak mohol replay vsetky kamene
            shotHistory: []
        };

        // Ulozenie room do Map a priradenie room ID obom hracom
        rooms.set(roomId, room);
        waiting.roomId = roomId;
        waiting.playerNumber = 1;  // Prvy hrac co cakal = hrac 1
        ws.roomId = roomId;
        ws.playerNumber = 2;       // Druhy hrac co prisiel = hrac 2

        // Poslanie game_start spravy obom hracom
        // Kazdy dostane: svoje cislo hraca, meno supera, konfiguraciu hry
        // Konfiguracia sa posiela klientom aby vedeli nastavit fyziku rovnako
        send(waiting, {
            type: 'game_start',
            player: 1,
            opponent: name,
            opponentUserId: ws.userId || 0,
            config: config
        });

        send(ws, {
            type: 'game_start',
            player: 2,
            opponent: waiting.playerName,
            opponentUserId: waiting.userId || 0,
            config: config
        });

        // Oznámenie komu sa hrá (hrac 1 zacina)
        broadcast(room, {
            type: 'turn',
            currentPlayer: 1,
            stonesLeft: { ...room.stonesLeft }
        });

        // Uvolnenie lobby slotu — uz je v hre
        waitingPlayers[difficulty] = null;
        // Broadcast noveho stavu lobby (slot sa uvolnil: 0/2)
        broadcastLobbyStatus();

        console.log('Room ' + roomId + ' created (' + difficulty + ')');
    } else {
        // Nikto necaka — skontrolujeme ci uz prebieha aktivna hra (moznost sledovat ako divak)
        const activeRoom = findActiveRoom(difficulty);
        if (activeRoom) {
            // Aktivna hra prebieha pre tuto obtiaznost → hrac sa stane divakom
            ws.roomId = activeRoom.id;
            ws.isSpectator = true;       // Priznak ze ide o divaka, nie hraca
            ws.playerNumber = 0;         // Divaci nemaju cislo hraca
            activeRoom.spectators.push(ws);

            // Posli divakovi aktualny stav hry — aby mohol zobrazit canvas a HUD
            send(ws, {
                type: 'spectate',
                config: config,
                difficulty: activeRoom.difficulty,
                currentTurn: activeRoom.currentTurn,
                stonesLeft: { ...activeRoom.stonesLeft },
                player1: activeRoom.players[0].playerName,
                player2: activeRoom.players[1].playerName,
                shotHistory: activeRoom.shotHistory || []
            });

            // Fialova systemova sprava o pripojenosti divaka pre vsetkych v room
            broadcastAll(activeRoom, {
                type: 'spectate_event',
                name: name,
                action: 'joined'
            });
            console.log(name + ' is spectating in ' + activeRoom.id);
        } else {
            // Nikto necaka a ziadna hra neprebieha → cakat v lobby
            waitingPlayers[difficulty] = ws;
            send(ws, { type: 'waiting', difficulty: difficulty });
            // Broadcast noveho stavu lobby (slot obsadeny: 1/2)
            broadcastLobbyStatus();
            console.log('Player waiting in ' + difficulty + ' lobby');
        }
    }
}

// ===========================================================================
// HANDLER: SHOOT — Hrac vystrelil kamen
// ===========================================================================
// Klient posle { type: 'shoot', vx: <cislo>, vy: <cislo> }
// vx/vy su zlozky vektora rychlosti (smer + sila) — vypocitane z dragnutia mysou
//
// *** KLUCOVY PRINCIP SYNCHRONIZACIE ***
// Fyzikalna simulacia beží na OBOCH klientoch (nie na serveri!)
// Server len preposle vektor vystrelu druhemu hracovi.
// Obaja klienti dostavaju ROVNAKE vstupne parametre a simuluju ROVNAKU fyziku.
// Preto su stavy na oboch stranach synchronne.
//
// Server validuje:
//   - Ci je hrac na tahu (currentTurn)
//   - Ci nie je pauza alebo koniec hry
//   - Ci neprebieha iny vystrel (shotInProgress)
function handleShoot(ws, msg) {
    const room = getRoom(ws);
    if (!room || room.paused || room.gameOver) return; // Validacia stavu
    if (ws.isSpectator) return;                        // Divaci nemozou strielat
    if (ws.playerNumber !== room.currentTurn) return;  // Nie je na tahu — ignorovat
    if (room.shotInProgress) return;                    // Uz sa striela — ignorovat

    // Extrahovanie vektora rychlosti zo spravy
    const vx = Number(msg.vx) || 0;
    const vy = Number(msg.vy) || 0;

    // Nastavenie stavu — prebieha vystrel
    room.shotInProgress = true;
    room.stonesLeft[ws.playerNumber]--;  // Znizenie poctu zostávajúcich kamenov

    // Ulozenie vystrelu do historie — pre neskorich divakov
    room.shotHistory.push({ vx: vx, vy: vy, player: ws.playerNumber });

    // Broadcast VSETKYM (hracom aj divakom) — obaja klienti + divaci dostanu
    // rovnaky vektor a spustia rovnaku fyzikalnu simulaciu
    broadcastAll(room, {
        type: 'shoot',
        vx: vx,
        vy: vy,
        player: ws.playerNumber
    });
}

// ===========================================================================
// HANDLER: STONES_STOPPED — Vsetky kamene sa zastavili
// ===========================================================================
// Klient posle tuto spravu ked detekuje ze vsetky kamene maju rychlost pod prahom
// Po dostatocnom pocte framov (STOPPED_FRAMES = 45).
// Server rozhodne:
//   A) Ak obaja hraci nemaju kamene → KONIEC HRY → vypocet vitaza
//   B) Inak → dalsi tah (striedanie hracov)
//
// *** URCENIE VITAZA ***
// Klient posle pozicie vsetkych kamenov na ploche.
// Server vypocita vzdialenost kazdeho kamena od ciela (target z config.json).
// Vitazi hrac ktoreho kamen je NAJBLIZSIE k ciel.
function handleStopped(ws, msg) {
    const room = getRoom(ws);
    if (!room) return;
    if (ws.isSpectator) return;  // Divaci nemaju fyzikalnu simulaciu na serveri

    // ==== SYNCHRONIZACIA: Cakanie na OBOCH hracov ====
    room.stoppedBy.add(ws.playerNumber);

    // Ulozime pozicie od prveho hraca ktory nahlasil stop (pouzijeme na konci hry)
    if (!room.lastStoppedPositions && Array.isArray(msg.positions)) {
        room.lastStoppedPositions = msg.positions;
    }

    // Ak este nehlasili obaja hraci, nastavime timeout (10s safety net)
    if (room.stoppedBy.size < 2) {
        if (!room.stoppedTimeout) {
            room.stoppedTimeout = setTimeout(function () {
                room.stoppedTimeout = null;
                if (room.stoppedBy.size >= 1 && !room.gameOver) {
                    console.log('Force-advancing turn in ' + room.id + ' (stoppedBy timeout)');
                    processStopped(room, room.lastStoppedPositions || []);
                }
            }, 10000);
        }
        return;
    }

    // Obaja hraci nahlasili stop — zrusime timeout a pokracujeme
    if (room.stoppedTimeout) {
        clearTimeout(room.stoppedTimeout);
        room.stoppedTimeout = null;
    }

    var positions = room.lastStoppedPositions || (Array.isArray(msg.positions) ? msg.positions : []);
    processStopped(room, positions);
}

// processStopped — spolocna logika po zastaveni kamenov
// Oddelene od handleStopped kvoli timeout safety mechanizmu
function processStopped(room, positions) {
    room.stoppedBy.clear();
    room.lastStoppedPositions = null;
    room.shotInProgress = false;

    // Kontrola konca hry — obaja hraci uz nemaju kamene
    if (room.stonesLeft[1] === 0 && room.stonesLeft[2] === 0) {
        room.gameOver = true;

        // Ziskanie pozicii kamenov od klienta
        const positions = Array.isArray(msg.positions) ? msg.positions : [];
        const target = config.target;

        // Pre kazdeho hraca najdeme jeho najblizssi kamen k cielu
        let minDist = { 1: Infinity, 2: Infinity };
        positions.forEach(s => {
            const p = Number(s.player);
            if (p !== 1 && p !== 2) return;
            // Euklidovska vzdialenost: sqrt((x2-x1)^2 + (y2-y1)^2)
            const dx = Number(s.x) - target.x;
            const dy = Number(s.y) - target.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist[p]) {
                minDist[p] = dist;
            }
        });

        // Urcenie vitaza — kto ma mensi minDist vyhra
        let winner = 0; // 0 = remiza
        if (minDist[1] < minDist[2]) winner = 1;
        else if (minDist[2] < minDist[1]) winner = 2;

        // Ziskanie userId hracov pre broadcast
        const pl1 = room.players[0];
        const pl2 = room.players[1];

        // Poslanie vysledku hracom AJ divakom
        broadcastAll(room, {
            type: 'game_over',
            winner: winner,
            distances: { 1: Math.round(minDist[1]), 2: Math.round(minDist[2]) },
            player1UserId: pl1 ? pl1.userId : 0,
            player2UserId: pl2 ? pl2.userId : 0
        });

        // Hra sa skoncila — lobby slot sa uvolni, broadcastneme 0/2 klientom v menu
        broadcastLobbyStatus();
        return;
    }

    // Hra este neskoncila — dalsi tah
    // Striedanie: ak bol na tahu hrac 1, dalej je hrac 2 (a naopak)
    room.currentTurn = room.currentTurn === 1 ? 2 : 1;

    // Ak hrac na tahu uz nema kamene, preskocime na druheho
    // (nastáva ked jeden hrac ma viac kamenov nez druhy)
    if (room.stonesLeft[room.currentTurn] === 0) {
        const other = room.currentTurn === 1 ? 2 : 1;
        if (room.stonesLeft[other] > 0) {
            room.currentTurn = other;
        }
    }

    // Oznámenie VSETKYM (hracom aj divakom) kto je na tahu
    broadcastAll(room, {
        type: 'turn',
        currentPlayer: room.currentTurn,
        stonesLeft: { ...room.stonesLeft }
    });
}

// ===========================================================================
// HANDLER: PAUSE — Pozastavenie hry
// ===========================================================================
// Pauzu moze dat len hrac ktory je AKTUALNE NA TAHU
function handlePause(ws) {
    const room = getRoom(ws);
    if (!room || room.paused || room.gameOver) return;
    if (ws.isSpectator) return;                        // Divaci nemozou pausovat
    if (ws.playerNumber !== room.currentTurn) return; // Len hrac na tahu

    room.paused = true;
    broadcastAll(room, { type: 'paused', by: ws.playerNumber });
}

// ===========================================================================
// HANDLER: RESUME — Pokracovanie hry po pauze
// ===========================================================================
// Pauzu moze zrusit KTORYKOLVEK hrac
function handleResume(ws) {
    const room = getRoom(ws);
    if (!room || !room.paused) return;
    if (ws.isSpectator) return;  // Divaci nemozou zrusit pauzu

    room.paused = false;
    broadcastAll(room, { type: 'resumed' });
}

// ===========================================================================
// HANDLER: RESTART_REQUEST — Ziadost o restart hry
// ===========================================================================
// Hrac ziada restart → server posle ziadost superovi
// Super sa moze rozhodnut: accept/decline
function handleRestartRequest(ws) {
    const room = getRoom(ws);
    if (!room) return;
    if (ws.isSpectator) return;             // Divaci nemozou ziadat restart
    if (room.restartRequestedBy) return; // Uz prebieha ina ziadost

    room.restartRequestedBy = ws.playerNumber;
    const opponent = getOpponent(ws);
    if (opponent) {
        send(opponent, { type: 'restart_request', by: ws.playerNumber });
    }
}

// ===========================================================================
// HANDLER: RESTART_ACCEPT — Super suhlasil s restartom
// ===========================================================================
// Resetuje sa cely stav room, nacita sa novy config, hra zacina odznova
function handleRestartAccept(ws) {
    const room = getRoom(ws);
    if (!room || !room.restartRequestedBy) return;
    if (ws.isSpectator) return;  // Divaci nemozou akceptovat restart

    // Reset celeho stavu hernej miestnosti
    room.currentTurn = 1;
    room.stonesLeft = { 1: config.stonesPerPlayer, 2: config.stonesPerPlayer };
    room.paused = false;
    room.restartRequestedBy = null;
    room.shotInProgress = false;
    room.gameOver = false;
    room.stoppedBy = new Set();    // Reset synchronizacneho setu
    room.cheatsActive = new Set(); // Reset cheat stavu — nove kolo zacina bez cheatov
    room.shotHistory = [];         // Reset historie vystrolov pre divakov
    room.lastStoppedPositions = null;
    if (room.stoppedTimeout) { clearTimeout(room.stoppedTimeout); room.stoppedTimeout = null; }

    // Poslanie noveho configu VSETKYM (hracom aj divakom) — moze sa zmenit medzi hrami
    broadcastAll(room, { type: 'restart', config: config });

    // Oznámenie prveho tahu VSETKYM
    broadcastAll(room, {
        type: 'turn',
        currentPlayer: 1,
        stonesLeft: { ...room.stonesLeft }
    });
}

// ===========================================================================
// HANDLER: RESTART_DECLINE — Super odmietol restart
// ===========================================================================
function handleRestartDecline(ws) {
    const room = getRoom(ws);
    if (!room || !room.restartRequestedBy) return;
    if (ws.isSpectator) return;  // Divaci nemozou odmietnut restart

    // Informovanie hraca ktory ziadal o restart
    room.restartRequestedBy = null;
    const opponent = getOpponent(ws);
    if (opponent) {
        send(opponent, { type: 'restart_declined' });
    }
}

// ===========================================================================
// HANDLER: CHAT — Chatova sprava od hraca
// ===========================================================================
// Klient posle { type: 'chat', text: 'Ahoj' }
// Server prida meno a cislo hraca a posle VSETKYM (hracom aj divakom).
// Specialny prikaz /cheats aktivuje cheat pre daneho hraca — zvacsi jeho kamene o 30%.
// Prikaz moze pouzit len hrac (nie divak), a len raz za hru.
function handleChat(ws, msg) {
    const room = getRoom(ws);
    if (!room) return;
    if (ws.isSpectator) return;  // Divaci pouzivaju 'spectate_chat' typ

    // Ocistenie textu — max 200 znakov (prevencia pred spam/XSS)
    const text = String(msg.text || '').substring(0, 200).trim();
    if (!text) return;

    // ==== CHEAT PRIKAZY ====
    // /cheats  → aktivuje cheat pre hraca (kamene o 30% vacsie)
    // /cheatss → deaktivuje cheat (vrati kamene na povodnu velkost)
    // Stav sleduje room.cheatsActive Set — moze sa togglovat kedy chce.
    if (text === '/cheats') {
        if (!room.cheatsActive.has(ws.playerNumber)) {
            // Cheat este nie je aktivny — aktivujeme
            room.cheatsActive.add(ws.playerNumber);
            broadcastAll(room, {
                type: 'cheat',
                player: ws.playerNumber,
                revert: false  // Zvacsenie kamenov
            });
        }
        return;  // /cheats sa nikdy nezobrazuje v chate
    }
    if (text === '/cheatss') {
        if (room.cheatsActive.has(ws.playerNumber)) {
            // Cheat je aktivny — deaktivujeme, vratime velkost
            room.cheatsActive.delete(ws.playerNumber);
            broadcastAll(room, {
                type: 'cheat',
                player: ws.playerNumber,
                revert: true  // Navratenie kamenov na povodnu velkost
            });
        }
        return;  // /cheatss sa tiez nikdy nezobrazuje v chate
    }

    // Broadcast beznej chatovej spravy VSETKYM (hracom aj divakom)
    broadcastAll(room, {
        type: 'chat',
        player: ws.playerNumber,
        name: ws.playerName,
        text: text
    });
}

// ===========================================================================
// HANDLER: SPECTATE_CHAT — Chatova sprava od divaka (s rate limitom)
// ===========================================================================
// Divak moze pisat do chatu max 1 spravu za 5 sekund (anti-spam).
// Sprava ide VSETKYM (hracom aj divakom) s priznakom spectator: true.
// Klient zobrazuje "Spectator Meno:" namiesto normalneho mena hraca.
function handleSpectateChat(ws, msg) {
    if (!ws.isSpectator) return;  // Len divaci pouzivaju tento typ spravy
    const room = getRoom(ws);
    if (!room) return;

    // Rate limit: max 1 sprava za 5 sekund
    const now = Date.now();
    if (ws.lastChatTime && (now - ws.lastChatTime) < 5000) {
        // Informuj klienta o rate limite (zostatok v ms)
        send(ws, { type: 'chat_ratelimit', msLeft: 5000 - (now - ws.lastChatTime) });
        return;
    }
    ws.lastChatTime = now;

    // Ocistenie textu — max 200 znakov
    const text = String(msg.text || '').substring(0, 200).trim();
    if (!text) return;

    // Broadcast chatovej spravy VSETKYM s priznakom spectator: true
    // Klient podla tohto priznak zobrazi "Spectator Meno:" vo fialovej farbe
    broadcastAll(room, {
        type: 'chat',
        player: 0,           // 0 = divak (nema farbu hraca)
        name: ws.playerName,
        text: text,
        spectator: true      // Klient zobrazi fialovú predponu "Spectator"
    });
}

// ===========================================================================
// ZAZNAMENANIE VYSLEDKU HRY — HTTP POST na PHP API
// ===========================================================================
// Po skonceni hry server posle vysledok do PHP API ktore aktualizuje
// databazove statistiky oboch hracov a globalny pocet hier.
// Auto-detekcia: Docker (nginx:80) vs VPS (localhost:80 s /zadanie3/ prefixom)
function recordGameResult(room, winner) {
    const p1 = room.players[0];
    const p2 = room.players[1];

    // Ak niektory hrac nema userId, nemusime zapisovat
    if (!p1.userId || !p2.userId) return;

    const isDraw = winner === 0;
    const winnerId = isDraw ? p1.userId : (winner === 1 ? p1.userId : p2.userId);
    const loserId = isDraw ? p2.userId : (winner === 1 ? p2.userId : p1.userId);

    const postData = JSON.stringify({
        winner_id: winnerId,
        loser_id: loserId,
        is_draw: isDraw
    });

    // Auto-detekcia prostredia:
    // Ak existuje env premenna VPS=1 alebo ak hostname 'nginx' nie je dostupny → VPS
    const isVPS = process.env.VPS === '1' || process.env.API_HOST === 'localhost';
    const apiHost = isVPS ? '127.0.0.1' : 'nginx';
    const apiPath = isVPS
        ? '/zadanie3/api/stats.php?action=record_game'
        : '/api/stats.php?action=record_game';

    const options = {
        hostname: apiHost,
        port: 80,
        path: apiPath,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            console.log('Game result recorded: winner=' + winnerId + ' loser=' + loserId + ' draw=' + isDraw + ' status=' + res.statusCode + ' body=' + body);
        });
    });
    req.on('error', (e) => {
        console.error('Failed to record game result:', e.message);
    });
    req.write(postData);
    req.end();
}

// ===========================================================================
// SPUSTENIE SERVERA — informacia do konzoly
// ===========================================================================

console.log('+-------------------------------------------+');
console.log('|  Curling WS server running on port ' + PORT + '   |');
console.log('+-------------------------------------------+');
