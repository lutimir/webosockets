// ===========================================================================
// CURLING ONLINE — KLIENTSKA HERNÁ LOGIKA
// ===========================================================================
// Tento subor obsahuje CELU klientsku cast hry:
//   1. WebSocket klient — pripojenie na server, prijimanie a odosielanie sprav
//   2. Fyzikalny engine (Matter.js) — kolizie, trenie, odrazy
//   3. Canvas rendering — kreslenie hracej plochy, kamenov, ciela, navigacie
//   4. Vstupna logika — myš/touch ovladanie (slingshot mechanika)
//   5. UI ovladanie — obrazovky, overlaye, HUD, chat, jazykove prepinanie
//
// *** AKO TO CELE FUNGUJE ***
// - Hrac otvori stranku → zobrazi sa menu
// - Zada meno, klikne "Hrat" → WebSocket sa pripoji na server
// - Server sparuje 2 hracov → posle game_start s konfiguráciou
// - Klient vytvori Matter.js engine a zacne renderovat hraciu plochu
// - Hrac na tahu klikne na kamen a tiahne mysou (slingshot)
// - Po pusteni mysi sa vypocita vektor rychlosti a posle serveru
// - Server vektor preposle druhemu hracovi
// - OBAJA klienti vytvoria kamen s rovnakym vektorom → rovnaka simulacia
// - Ked sa kamene zastavia, klient posle serveru pozicie → server rozhodne dalsi tah
//
// *** PRECO FIZIKA BEZI NA KLIENTOVI A NIE NA SERVERI ***
// WebSocket server len preposiela vektory vystrelov. Fyzikalnu simulaciu
// pocita KAZDY klient sam. Kedze obaja dostavaju ROVNAKE vstupne parametre
// (rovnaky vektor, rovnake nastavenie trenia, rovnake pozicie), simulacia
// je DETERMINISTICKA — obaja klienti maju rovnaky stav hry.
// Toto znizuje zataz na serveri a eliminuje lag.
// ===========================================================================

(function () {
    'use strict';

    // =====================================================================
    // IMPORTY Z MATTER.JS — fyzikálny engine
    // =====================================================================
    // Matter.js je fyzikalna kniznica ktora riesi:
    //   - Kolízie medzi telesami (kruh-kruh, kruh-obdlznik)
    //   - Trenie (spomalovanie kamenov)
    //   - Odrazy (restitution = "pružnosť" odrazu)
    //   - Gravitáciu (v curling je vypnuta — hracia plocha je zhora)
    var Engine = Matter.Engine;     // Hlavny engine — spusta simulaciu
    var World = Matter.World;       // Svet — obsahuje vsetky telesa
    var Bodies = Matter.Bodies;     // Tovaren na telesa (circle, rectangle)
    var Body = Matter.Body;         // Operacie nad telesami (setVelocity)
    var Composite = Matter.Composite; // Skupiny telies

    // =====================================================================
    // KONSTANTY
    // =====================================================================
    var SPEED_THRESHOLD = 0.12;  // Ak je rychlost kamena pod touto hodnotou, povazujeme ho za zastaveny
    var STOPPED_FRAMES = 45;     // Kolko po sebe iducich framov musia byt VSETKY kamene pomale
    var MAX_DRAG = 140;          // Maximalny tah mysou v pixeloch = 100% sily

    // Zoom konstanty pre pinch-to-zoom na mobile
    var MIN_ZOOM = 1.0;          // Minimalny zoom = povodna velkost
    var MAX_ZOOM = 3.0;          // Maximalny zoom = 3x priblizenie

    // Faktor zvacsenia kamenov po /cheats prikaze (1.3 = +30%)
    // *** ZMEN TUTO HODNOTU ak chces iny efekt cheat kodu ***
    var CHEAT_SCALE = 2.3;

    // =====================================================================
    // FARBY — 3 farebny dizajn (#16213e navy, #e74c3c cervena, #3498db modra)
    // =====================================================================
    var COLORS = {
        bg: '#16213e',
        field: '#dfe6e9',
        fieldStroke: '#b2bec3',
        player1: '#e74c3c',
        player2: '#3498db',
        stoneStroke: '#2c3e50',
        aimLine: '#f39c12',
        white: '#ffffff',
        targetRing1: 'rgba(231,76,60,0.12)',
        targetRing2: 'rgba(255,255,255,0.5)',
        targetRing3: 'rgba(52,152,219,0.15)',
        targetCenter: 'rgba(231,76,60,0.18)',
        crosshair: 'rgba(0,0,0,0.08)',
        hogLine: 'rgba(0,0,0,0.06)'
    };

    // =====================================================================
    // API BASE URL — automaticka detekcia pre Docker aj VPS
    // =====================================================================
    function getApiBase() {
        var path = window.location.pathname;
        var idx = path.indexOf('/curling');
        var base = idx >= 0 ? path.substring(0, idx) : '';
        return base + '/api';
    }

    // =====================================================================
    // WEBSOCKET URL — automaticka detekcia adresy servera
    // =====================================================================
    // Funkcia automaticky zostavi WebSocket URL na zaklade aktualnej adresy v prehliadaci.
    // Ak sme na https → pouzijeme wss (zabezpeceny WebSocket)
    // Z cesty /zadanie3/curling/ extrahujeme /zadanie3/ a pridame /ws/
    // Vysledok: wss://node69.webte.fei.stuba.sk/zadanie3/ws/
    // Nginx potom tuto poziadavku preposlat na localhost:3000 (Node.js server)
    function getWsUrl() {
        var loc = window.location;
        var protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        // Lokalny vyvoj (Live Server alebo iny port ≠ 80/8080/443) — pripoj priamo na WS port
        // Na produkcii Nginx proxuje /ws/ → localhost:3000, ale Live Server to nerobi.
        var port = parseInt(loc.port, 10);
        if (port && port !== 80 && port !== 443 && port !== 8080) {
            return 'ws://' + loc.hostname + ':3000/';
        }
        // Produkcia / Docker — pouzijeme Nginx proxy cestu /ws/
        var path = loc.pathname;
        var base = path.substring(0, path.indexOf('/curling'));
        return protocol + '//' + loc.host + base + '/ws/';
    }

    // =====================================================================
    // HLAVNY OBJEKT HRY — Konstruktor
    // =====================================================================
    // CurlingGame je hlavny objekt ktory drzi CELY stav hry na strane klienta.
    // Pouzivame prototypovy vzor (nie class) pre kompatibilitu.
    function CurlingGame() {
        // --- Prihlaseny uzivatel (z PHP session) ---
        this.currentUser = null;   // { id, username, is_guest, is_admin }
        // --- Lobby chat ---
        this.lobbyChatInterval = null;  // Interval pre polling lobby sprav
        this.lastLobbyMsgTime = null;   // Timestamp poslednej spravy (optimalizacia)
        this.lobbyChatCooldown = false;  // 5-sekundovy cooldown na odosielanie sprav
        // --- Konfiguracia z config.json (dostaneme od servera pri game_start) ---
        this.config = null;
        // --- WebSocket spojenie ---
        this.ws = null;
        // --- Pasivne WS spojenie pre online pocitadlo (menu obrazovka) ---
        this.statusWs = null;
        // --- Aktualna obrazovka (menu/rules/lobby/game) ---
        this.screen = 'menu';
        // --- Stav lobby (kolko hracov caka v kazdom mode) ---
        this.lobbyStatus = { easy: 0, hard: 0 };

        // --- Info o hracovi ---
        this.playerNumber = 0;    // 1 alebo 2 (priradene serverom)
        this.playerName = '';      // Meno zadane v menu
        this.opponentName = '';    // Meno supera (dostaneme od servera)

        // --- Stav hry ---
        this.currentTurn = 0;              // Kto je na tahu (1 alebo 2)
        this.stonesLeft = { 1: 0, 2: 0 };  // Kolko kamenov zostava kazdemu hracovi
        this.isMyTurn = false;              // Ci som JA na tahu
        this.paused = false;                // Ci je hra pozastavena
        this.gameOver = false;              // Ci je hra ukoncena

        // --- Matter.js engine a kamene ---
        this.engine = null;       // Matter.js Engine instancia
        this.stones = [];         // Pole objektov { body, player, num }
        this.showPhantom = false; // Ci zobrazovat fantomovy kamen (miesto odkial strielam)

        // --- Miereni (aim) stav ---
        this.isAiming = false;    // Ci hrac prave drzi mys a mieri
        this.aimCurrent = null;   // Aktualna pozicia kurzora pri miereni
        this.shotSent = false;    // Ci uz bol vystrel odoslany (zabranuje dvojitemu vystrelu)

        // --- Detekcia zastavenia kamenov ---
        this.waitingForStop = false;  // Ci cakame kym sa kamene zastavia
        this.stoppedCount = 0;        // Pocitadlo framov kde su vsetky kamene pomale

        // --- Canvas rendering ---
        this.canvas = null;   // <canvas> element
        this.ctx = null;      // 2D context pre kreslenie
        this.scale = 1;       // Pomer zvacsenia (responsivita)
        this.offsetX = 0;     // Posun hracej plochy na X (centrovanie)
        this.offsetY = 0;     // Posun hracej plochy na Y (centrovanie)

        // --- Pinch-to-zoom na mobile ---
        // userZoom: aktualna uroven priblizenia (1.0 = normalna, max 3.0)
        // zoomCenterX/Y: bod okolo ktoreho sa zoomuje (virtualny suradnicovy system)
        // pinchStartDist: vzdialenost medzi dvoma prstami pri zaciatku pinch gesta
        // pinchStartZoom: uroven zoomu na zaciatku pinch gesta
        this.userZoom = 1.0;
        this.zoomCenterX = 0;
        this.zoomCenterY = 0;
        this.pinchStartDist = 0;
        this.pinchStartZoom = 1.0;

        // --- UI stav ---
        this.notifTimeout = null;  // Timeout pre notifikaciu
        this.animFrame = null;     // requestAnimationFrame ID

        // --- Nastavenia (ulozene v prehliadaci) ---
        this.difficulty = 'easy';  // 'easy' = s navigacnou sipkou, 'hard' = bez
        this.lang = 'sk';          // Jazyk: 'sk' alebo 'en'
        this.theme = 'dark';       // Tema: 'dark' alebo 'light'

        // --- Divak (spectator) mod ---
        // isSpectator: true ak este sleduje hru bez aktivnej ulohy hraca
        // spectatorPlayer1/2Name: mena hracov ktore dostal z 'spectate' spravy
        // spectatorCooldown: klientsky rate-limit pre chat (5s po odoslani spravy)
        this.isSpectator = false;
        this.spectatorPlayer1Name = '';
        this.spectatorPlayer2Name = '';
        this.spectatorCooldown = false;

        // --- Cheat stav ---
        // cheatScale: multiplikator pre velkost kamenov hraca (1.0 = normalne, 1.3 po /cheats)
        // Aplikuje sa pri vytvarani novych kamenov v onShoot() a vizualne v drawStones()
        this.cheatScale = { 1: 1.0, 2: 1.0 };

        // =====================================================================
        // PREKLADY — kompletny slovnik SK/EN pre cele UI
        // =====================================================================
        // Kazda textova hodnota v hre je prekladatelna.
        // Metoda t('kluc') vracia preklad podla aktualneho jazyka.
        this.translations = {
            sk: {
                yourTurn: 'Tvoj ťah',
                opponentTurn: 'Ťah súpera',
                stonesMoving: 'Kamene sa pohybujú...',
                paused: 'Pauza',
                gameEnd: 'Koniec hry',
                gameStarted: 'Hra začala! Si hráč ',
                gameRestarted: 'Hra reštartovaná',
                opponentName: 'Súper: ',
                youWin: 'Vyhral si!',
                youLose: 'Prehral si!',
                draw: 'Remíza!',
                pauseBtn: 'Pauza',
                restartBtn: 'Reštart',
                continueBtn: 'Pokračovať',
                newGame: 'Nová hra',
                leave: 'Odísť',
                restartTitle: 'Reštart hry',
                restartAsk: 'Súper žiada o reštart hry.',
                agree: 'Súhlasiť',
                decline: 'Odmietnuť',
                disconnected: 'Súper sa odpojil z hry.',
                disconnectTitle: 'Odpojenie',
                restartSent: 'Žiadosť o reštart odoslaná',
                restartDeclined: 'Súper odmietol reštart',
                continues: 'Hra pokračuje',
                pauseOnly: 'Pauzu môže dať len hráč na ťahu',
                waiting: 'Čakaj...',
                chatHeader: 'Chat',
                msgPlaceholder: 'Správa...',
                // Menu & UI
                title: 'CURLING',
                subtitle: 'Online hra pre dvoch hráčov',
                namePlaceholder: 'Zadaj meno...',
                play: 'Hrať',
                rules: 'Pravidlá',
                easy: 'Ľahká',
                hard: 'Ťažká',
                easyDesc: 's navigáciou',
                hardDesc: 'bez navigácie',
                back: 'Späť',
                cancel: 'Zrušiť',
                lobbyWaiting: 'Čakanie na súpera...',
                spectate: 'Sledovať',            // Tlacidlo pre spektatorsky mod
                spectatorJoined: ' sa pripojil ako divák.',  // Chat notifikacia
                spectatorLeft: ' prestal sledovať hru.',     // Chat notifikacia,
                rulesTitle: 'Pravidlá hry',
                pauseTitle: 'PAUZA',
                ok: 'OK',
                // Rules text
                ruleGoal: '<strong>Cieľ:</strong> Umiestni svoje kamene čo najbližšie k stredu cieľa (domu).',
                ruleControls: '<strong>Ovládanie:</strong> Klikni na kameň a ťahni myšou. Čím dlhší ťah, tým väčšia sila.',
                ruleTurns: '<strong>Striedanie:</strong> Hráči sa striedajú po jednom kameni.',
                rulePhysics: '<strong>Fyzika:</strong> Kamene sa spomaľujú trením, odrážajú od stien aj od seba.',
                ruleWinner: '<strong>Víťaz:</strong> Kto má kameň najbližšie k stredu.',
                rulePause: '<strong>Pauza:</strong> Pozastaviť môže len hráč na ťahu.',
                ruleRestart: '<strong>Reštart:</strong> Po súhlase oboch hráčov.',
                // Game log
                turnLog: 'Na rade je hráč ',
                shotLog: ' vystrelil kameň #',
                collisionLog: 'Kameň #%a narazil do kameňa #%b',
                wallBounce: 'Kameň #%a sa odrazil od steny',
                stonesStopped: 'Kamene sa zastavili',
                rotateMsg: 'Otoč telefón na šírku pre hru',
                playerWins: ' vyhral!',  // Pouziva sa v game-over overlay pre divakov
                // Auth & lobby
                login: 'Prihlásenie',
                register: 'Registrácia',
                loginBtn: 'Prihlásiť sa',
                registerBtn: 'Registrovať sa',
                guestBtn: 'Hrať ako hosť',
                orDivider: 'alebo',
                loggedAs: 'Prihlásený: ',
                logout: 'Odhlásiť',
                leaderboard: 'Rebríček',
                totalGames: 'Celkovo hier: ',
                myStats: 'Moje štatistiky',
                gamesPlayed: 'Zápasy: ',
                winsLabel: 'Výhry: ',
                lossesLabel: 'Prehry: ',
                winRate: 'Úspešnosť: ',
                lobbyChat: 'Lobby Chat',
                chatToggle: 'CHAT',
                lbToggle: 'REBRÍČEK',
                lobbyCooldown: 'Počkaj 5 sekúnd',
                sessionKicked: 'Boli ste odhlásení — prihlásení z iného zariadenia',
                drawsLabel: 'Remízy: ',
                usernamePlaceholder: 'Meno...',
                passwordPlaceholder: 'Heslo...'
            },
            en: {
                yourTurn: 'Your turn',
                opponentTurn: 'Opponent\'s turn',
                stonesMoving: 'Stones moving...',
                paused: 'Paused',
                gameEnd: 'Game over',
                gameStarted: 'Game started! You are player ',
                gameRestarted: 'Game restarted',
                opponentName: 'Opponent: ',
                youWin: 'You win!',
                youLose: 'You lose!',
                draw: 'Draw!',
                pauseBtn: 'Pause',
                restartBtn: 'Restart',
                continueBtn: 'Continue',
                newGame: 'New game',
                leave: 'Leave',
                restartTitle: 'Restart game',
                restartAsk: 'Opponent requests a restart.',
                agree: 'Accept',
                decline: 'Decline',
                disconnected: 'Opponent disconnected.',
                disconnectTitle: 'Disconnected',
                restartSent: 'Restart request sent',
                restartDeclined: 'Opponent declined restart',
                continues: 'Game continues',
                pauseOnly: 'Only current player can pause',
                waiting: 'Wait...',
                chatHeader: 'Chat',
                msgPlaceholder: 'Message...',
                // Menu & UI
                title: 'CURLING',
                subtitle: 'Online game for two players',
                namePlaceholder: 'Enter name...',
                play: 'Play',
                rules: 'Rules',
                easy: 'Easy',
                hard: 'Hard',
                easyDesc: 'with aim guide',
                hardDesc: 'no aim guide',
                back: 'Back',
                cancel: 'Cancel',
                lobbyWaiting: 'Waiting for opponent...',
                spectate: 'Watch',                    // Spectate button
                spectatorJoined: ' joined as spectator.',   // Chat notification
                spectatorLeft: ' stopped watching.',        // Chat notification,
                rulesTitle: 'Game Rules',
                pauseTitle: 'PAUSED',
                ok: 'OK',
                // Rules text
                ruleGoal: '<strong>Goal:</strong> Place your stones as close to the center of the target as possible.',
                ruleControls: '<strong>Controls:</strong> Click the stone and drag. Longer drag = more power.',
                ruleTurns: '<strong>Turns:</strong> Players take turns throwing one stone at a time.',
                rulePhysics: '<strong>Physics:</strong> Stones slow down from friction and bounce off walls and each other.',
                ruleWinner: '<strong>Winner:</strong> Whoever has the closest stone to the center.',
                rulePause: '<strong>Pause:</strong> Only the current player can pause.',
                ruleRestart: '<strong>Restart:</strong> Both players must agree.',
                // Game log
                turnLog: 'Player ',
                shotLog: ' shot stone #',
                collisionLog: 'Stone #%a hit stone #%b',
                wallBounce: 'Stone #%a bounced off the wall',
                stonesStopped: 'Stones stopped',
                rotateMsg: 'Rotate your phone to landscape mode',
                playerWins: ' wins!',  // Used in game-over overlay for spectators
                // Auth & lobby
                login: 'Login',
                register: 'Register',
                loginBtn: 'Sign in',
                registerBtn: 'Sign up',
                guestBtn: 'Play as Guest',
                orDivider: 'or',
                loggedAs: 'Logged in: ',
                logout: 'Log out',
                leaderboard: 'Leaderboard',
                totalGames: 'Total games: ',
                myStats: 'My stats',
                gamesPlayed: 'Games: ',
                winsLabel: 'Wins: ',
                lossesLabel: 'Losses: ',
                winRate: 'Win rate: ',
                lobbyChat: 'Lobby Chat',
                chatToggle: 'CHAT',
                lbToggle: 'LEADERBOARD',
                lobbyCooldown: 'Wait 5 seconds',
                sessionKicked: 'You have been logged out — logged in from another device',
                drawsLabel: 'Draws: ',
                usernamePlaceholder: 'Username...',
                passwordPlaceholder: 'Password...'
            }
        };

        this.setupUI();
        this.setupAuthUI();
        this.applyLanguage();
        this.startLoop();
        // Vycistenie input policok — prevencia browser autocomplete
        var authInputs = ['auth-username', 'auth-password', 'reg-username', 'reg-password'];
        for (var ai = 0; ai < authInputs.length; ai++) {
            var inp = document.getElementById(authInputs[ai]);
            if (inp) inp.value = '';
        }
        // Kontrola existujucej session — ak je prihlaseny, presmeruj na menu
        this.checkSession();
        // Spusti pasivne WS spojenie pre online pocitadlo na menu obrazovke
        this.connectStatusWs();
    }

    // =========================================================================
    // SETUP UI — Registracia event listenerov na vsetky tlacidla a input polia
    // =========================================================================
    // Tato funkcia priradi click/keydown handlery pre:
    //   - Menu: meno, obtiaznost, hrat, pravidla
    //   - Lobby: zrusit
    //   - Hra: pauza, restart, overlay tlacidla
    //   - Chat: odoslanie spravy
    //   - Globalne: prepinanie jazyka a temy
    CurlingGame.prototype.setupUI = function () {
        var self = this;

        // Tlacidlo "Hrat" — pripojenie na WS server s menom z auth
        document.getElementById('btn-play').addEventListener('click', function () {
            if (!self.currentUser) return;
            self.connect(self.currentUser.username);
        });

        // Tlacidlo "Sledovat" — zobrazuje sa ked je lobby 2/2 (hra uz prebieha)
        document.getElementById('btn-spectate').addEventListener('click', function () {
            if (!self.currentUser) return;
            self.connect(self.currentUser.username);
        });

        // Tlacidla obtiaznosti — prepnutie easy/hard a vizualne zvyraznenie
        var diffBtns = document.querySelectorAll('.btn-diff');
        for (var i = 0; i < diffBtns.length; i++) {
            diffBtns[i].addEventListener('click', function () {
                for (var j = 0; j < diffBtns.length; j++) {
                    diffBtns[j].classList.remove('selected');
                }
                this.classList.add('selected');
                self.difficulty = this.getAttribute('data-diff');
                // Po zmene obtiaznosti aktualizujeme viditelnost Sledovat tlacidla
                self.updateSpectateButton();
            });
        }

        // Pravidla — prepne na obrazovku pravidiel
        document.getElementById('btn-rules').addEventListener('click', function () {
            self.showScreen('rules');
        });

        // Spat z pravidiel do menu
        document.getElementById('btn-back-menu').addEventListener('click', function () {
            self.showScreen('menu');
        });

        // Zrusit hladanie supera — odpoji WS a vrati do menu
        document.getElementById('btn-cancel').addEventListener('click', function () {
            self.disconnect();
            self.showScreen('menu');
        });

        // Pauza — pozastavenie hry (len hrac na tahu)
        document.getElementById('btn-pause').addEventListener('click', function () {
            self.togglePause();
        });

        // Pokracovat po pauze — zrusenie pauzy
        document.getElementById('btn-resume').addEventListener('click', function () {
            self.togglePause();
        });

        // Restart — posle ziadost superovi, caka na potvrdenie
        document.getElementById('btn-restart-req').addEventListener('click', function () {
            self.requestRestart();
        });

        // Suhlasit s restartom — posle accept serveru
        document.getElementById('btn-accept-restart').addEventListener('click', function () {
            self.send({ type: 'restart_accept' });
            self.hideOverlay('overlay-restart');
        });

        // Odmietnut restart — posle decline serveru
        document.getElementById('btn-decline-restart').addEventListener('click', function () {
            self.send({ type: 'restart_decline' });
            self.hideOverlay('overlay-restart');
        });

        // Nova hra po konci — posle restart request
        document.getElementById('btn-new-game').addEventListener('click', function () {
            self.requestRestart();
            self.hideOverlay('overlay-gameover');
        });

        // Odist — odpoji WS, zatvori overlaye, vrati do menu
        document.getElementById('btn-leave').addEventListener('click', function () {
            self.disconnect();
            self.hideAllOverlays();
            self.showScreen('menu');
        });

        // OK po odpojeni supera — zatvori overlay a vrati do menu
        document.getElementById('btn-disconnect-ok').addEventListener('click', function () {
            self.hideOverlay('overlay-disconnect');
            self.showScreen('menu');
        });

        // Chat
        document.getElementById('btn-chat-send').addEventListener('click', function () {
            self.sendChat();
        });

        document.getElementById('chat-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                self.sendChat();
            }
        });

        // Language toggle (all buttons with class toggle-lang)
        var langBtns = document.querySelectorAll('.toggle-lang');
        for (var li = 0; li < langBtns.length; li++) {
            langBtns[li].addEventListener('click', function () {
                self.lang = self.lang === 'sk' ? 'en' : 'sk';
                var allLang = document.querySelectorAll('.toggle-lang');
                for (var lj = 0; lj < allLang.length; lj++) {
                    allLang[lj].textContent = self.lang.toUpperCase();
                }
                self.applyLanguage();
            });
        }

        // Theme toggle (all buttons with class toggle-theme)
        var themeBtns = document.querySelectorAll('.toggle-theme');
        for (var ti = 0; ti < themeBtns.length; ti++) {
            themeBtns[ti].addEventListener('click', function () {
                if (self.theme === 'dark') {
                    self.theme = 'light';
                    document.body.classList.add('light');
                } else {
                    self.theme = 'dark';
                    document.body.classList.remove('light');
                }
                var icon = self.theme === 'light' ? '\u2600' : '\u263E';
                var allTheme = document.querySelectorAll('.toggle-theme');
                for (var tj = 0; tj < allTheme.length; tj++) {
                    allTheme[tj].textContent = icon;
                }
            });
        }
    };

    CurlingGame.prototype.showScreen = function (name) {
        var screens = document.querySelectorAll('.screen');
        for (var i = 0; i < screens.length; i++) {
            screens[i].classList.remove('active');
        }
        document.getElementById('screen-' + name).classList.add('active');
        this.screen = name;

        // Hide global toggles during game (they're in chat header)
        var gt = document.getElementById('global-toggles');
        if (gt) gt.style.display = (name === 'game') ? 'none' : 'flex';

        // Start/stop lobby chat polling
        if (name === 'menu') {
            this.startLobbyChat();
            this.fetchLeaderboard();
            // Reset panel visibility pri navrate do menu
            var lbPanel = document.getElementById('menu-leaderboard');
            var chatPanel = document.getElementById('lobby-chat-panel');
            if (lbPanel) lbPanel.style.display = '';
            if (chatPanel) chatPanel.style.display = '';
            var btnOpenLb = document.getElementById('btn-open-menu-lb');
            var btnOpenChat = document.getElementById('btn-open-lobby-chat');
            if (btnOpenLb) btnOpenLb.style.display = 'none';
            if (btnOpenChat) btnOpenChat.style.display = 'none';
        } else {
            this.stopLobbyChat();
        }

        if (name === 'game') {
            this.setupCanvas();
            this.fetchLeaderboard();  // Refresh game leaderboard
        }
    };

    CurlingGame.prototype.showOverlay = function (id) {
        document.getElementById(id).classList.remove('hidden');
    };

    CurlingGame.prototype.hideOverlay = function (id) {
        document.getElementById(id).classList.add('hidden');
    };

    CurlingGame.prototype.hideAllOverlays = function () {
        var overlays = document.querySelectorAll('.overlay');
        for (var i = 0; i < overlays.length; i++) {
            overlays[i].classList.add('hidden');
        }
    };

    CurlingGame.prototype.notify = function (text) {
        var el = document.getElementById('notification');
        el.textContent = text;
        el.classList.remove('hidden');
        clearTimeout(this.notifTimeout);
        this.notifTimeout = setTimeout(function () {
            el.classList.add('hidden');
        }, 3000);
    };

    CurlingGame.prototype.updateHUD = function () {
        if (!this.config) return;

        // Urcenie mien pre lavy (P1) a pravy (P2) HUD slot
        // Pre divakov mame priamo spectatorPlayer1/2Name, pre hracov rozlisujeme podla playerNumber
        var n1, n2;
        if (this.isSpectator) {
            n1 = this.spectatorPlayer1Name;
            n2 = this.spectatorPlayer2Name;
        } else {
            n1 = this.playerNumber === 1 ? this.playerName : this.opponentName;
            n2 = this.playerNumber === 2 ? this.playerName : this.opponentName;
        }

        document.getElementById('hud-name1').textContent = n1;
        document.getElementById('hud-name2').textContent = n2;

        var total = this.config.stonesPerPlayer;

        var html1 = '';
        for (var i = 0; i < total; i++) {
            var used = i >= this.stonesLeft[1];
            html1 += '<span class="stone-dot p1' + (used ? ' used' : '') + '"></span>';
        }
        document.getElementById('hud-stones1').innerHTML = html1;

        var html2 = '';
        for (var j = 0; j < total; j++) {
            var used2 = j >= this.stonesLeft[2];
            html2 += '<span class="stone-dot p2' + (used2 ? ' used' : '') + '"></span>';
        }
        document.getElementById('hud-stones2').innerHTML = html2;

        if (this.gameOver) {
            document.getElementById('hud-turn').textContent = this.t('gameEnd');
        } else if (this.paused) {
            document.getElementById('hud-turn').textContent = this.t('paused');
        } else if (this.waitingForStop) {
            document.getElementById('hud-turn').textContent = this.t('stonesMoving');
        } else if (this.isSpectator) {
            // Divak — zobrazuje meno hraca ktory je momentalne na tahu
            var tName = this.currentTurn === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name;
            document.getElementById('hud-turn').textContent = tName;
        } else if (this.isMyTurn) {
            document.getElementById('hud-turn').textContent = this.t('yourTurn');
        } else {
            document.getElementById('hud-turn').textContent = this.t('opponentTurn');
        }
    };

    // Translation helper
    CurlingGame.prototype.t = function (key) {
        return this.translations[this.lang][key] || key;
    };

    // Apply language to all static UI elements
    CurlingGame.prototype.applyLanguage = function () {
        // Menu screen
        var menuSub = document.querySelector('#screen-menu .subtitle');
        if (menuSub) menuSub.textContent = this.t('subtitle');
        document.getElementById('btn-play').textContent = this.t('play');
        // Tlacidlo Sledovat — text sa updatuje, viditelnost riadi updateSpectateButton
        var spectateBtn = document.getElementById('btn-spectate');
        if (spectateBtn) spectateBtn.textContent = this.t('spectate');
        document.getElementById('btn-rules').textContent = this.t('rules');

        var diffBtns = document.querySelectorAll('.btn-diff');
        if (diffBtns.length >= 2) {
            diffBtns[0].childNodes[0].textContent = this.t('easy');
            diffBtns[0].querySelector('.diff-label').textContent = this.t('easyDesc');
            diffBtns[1].childNodes[0].textContent = this.t('hard');
            diffBtns[1].querySelector('.diff-label').textContent = this.t('hardDesc');
        }

        // Rules screen
        var rulesH = document.querySelector('#screen-rules h2');
        if (rulesH) rulesH.textContent = this.t('rulesTitle');
        document.getElementById('btn-back-menu').textContent = this.t('back');
        var rulePs = document.querySelectorAll('.rules-text p');
        var ruleKeys = ['ruleGoal', 'ruleControls', 'ruleTurns', 'rulePhysics', 'ruleWinner', 'rulePause', 'ruleRestart'];
        for (var i = 0; i < rulePs.length && i < ruleKeys.length; i++) {
            rulePs[i].innerHTML = this.t(ruleKeys[i]);
        }

        // Lobby screen
        var lobbyH = document.querySelector('#screen-lobby h2');
        if (lobbyH) lobbyH.textContent = this.t('lobbyWaiting');
        document.getElementById('btn-cancel').textContent = this.t('cancel');

        // Game controls
        document.getElementById('btn-pause').textContent = this.t('pauseBtn');
        document.getElementById('btn-restart-req').textContent = this.t('restartBtn');
        document.getElementById('btn-resume').textContent = this.t('continueBtn');
        document.getElementById('btn-new-game').textContent = this.t('newGame');
        document.getElementById('btn-leave').textContent = this.t('leave');
        document.getElementById('chat-input').placeholder = this.t('msgPlaceholder');

        var chatH = document.getElementById('chat-header-text');
        if (chatH) chatH.textContent = this.t('chatHeader');

        // Pause overlay
        var pauseH = document.querySelector('#overlay-pause h2');
        if (pauseH) pauseH.textContent = this.t('pauseTitle');

        // Restart overlay
        var rtTitle = document.querySelector('#overlay-restart h2');
        if (rtTitle) rtTitle.textContent = this.t('restartTitle');
        var rtP = document.querySelector('#overlay-restart p');
        if (rtP) rtP.textContent = this.t('restartAsk');
        document.getElementById('btn-accept-restart').textContent = this.t('agree');
        document.getElementById('btn-decline-restart').textContent = this.t('decline');

        // Game over overlay
        document.getElementById('btn-new-game').textContent = this.t('newGame');
        document.getElementById('btn-leave').textContent = this.t('leave');

        // Disconnect overlay
        var dcTitle = document.querySelector('#overlay-disconnect h2');
        if (dcTitle) dcTitle.textContent = this.t('disconnectTitle');
        var dcP = document.querySelector('#overlay-disconnect p');
        if (dcP) dcP.textContent = this.t('disconnected');
        document.getElementById('btn-disconnect-ok').textContent = this.t('ok');

        // Rotate message
        var rotateText = document.getElementById('rotate-text');
        if (rotateText) rotateText.textContent = this.t('rotateMsg');

        // Auth screen subtitle
        var authSub = document.querySelector('#screen-auth .subtitle');
        if (authSub) authSub.textContent = this.t('subtitle');

        // Auth input placeholders
        var authUser = document.getElementById('auth-username');
        if (authUser) authUser.placeholder = this.t('usernamePlaceholder');
        var authPass = document.getElementById('auth-password');
        if (authPass) authPass.placeholder = this.t('passwordPlaceholder');
        var regUser = document.getElementById('reg-username');
        if (regUser) regUser.placeholder = this.t('usernamePlaceholder');
        var regPass = document.getElementById('reg-password');
        if (regPass) regPass.placeholder = this.t('passwordPlaceholder');

        // Auth screen
        var authTabs = document.querySelectorAll('.auth-tab');
        if (authTabs.length >= 2) {
            authTabs[0].textContent = this.t('login');
            authTabs[1].textContent = this.t('register');
        }
        var loginBtn = document.getElementById('btn-login');
        if (loginBtn) loginBtn.textContent = this.t('loginBtn');
        var regBtn = document.getElementById('btn-register');
        if (regBtn) regBtn.textContent = this.t('registerBtn');
        var guestBtn = document.getElementById('btn-guest');
        if (guestBtn) guestBtn.textContent = this.t('guestBtn');
        var authDiv = document.querySelector('.auth-divider span');
        if (authDiv) authDiv.textContent = this.t('orDivider');
        var logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.textContent = this.t('logout');

        // Lobby chat header & leaderboard header
        var lbHeaderText = document.getElementById('lb-header-text');
        if (lbHeaderText) lbHeaderText.textContent = this.t('leaderboard');
        var lobbyChatHeader = document.getElementById('lobby-chat-header-text');
        if (lobbyChatHeader) lobbyChatHeader.textContent = this.t('lobbyChat');
        var lobbyChatInput = document.getElementById('lobby-chat-input');
        if (lobbyChatInput) lobbyChatInput.placeholder = this.t('msgPlaceholder');

        // Toggle buttons (text labels)
        var btnOpenChat = document.getElementById('btn-open-lobby-chat');
        if (btnOpenChat) btnOpenChat.textContent = this.t('chatToggle');
        var btnOpenLb = document.getElementById('btn-open-menu-lb');
        if (btnOpenLb) btnOpenLb.textContent = this.t('lbToggle');

        // User display
        if (this.currentUser) {
            document.getElementById('user-display').textContent =
                this.t('loggedAs') + this.currentUser.username;
        }

        // Refresh my stats labels
        this.fetchMyStats();

        this.updateHUD();
    };

    // =========================================================================
    // WEBSOCKET KLIENT — pripojenie na server
    // =========================================================================
    // Tato metoda sa zavola ked hrac klikne "Hrat" v menu.
    // 1. Vytvori WebSocket spojenie na URL ziskanu z getWsUrl()
    // 2. Po uspesnom pripojeni posle serveru { type: 'join', name: 'Meno' }
    // 3. Server bud posle 'waiting' (nikto necaka) alebo 'game_start' (sparovanie)
    //
    // WebSocket API (nativne v prehliadaci) ma 4 udalosti:
    //   onopen — spojenie bolo uspesne nadviazane
    //   onmessage — prisla sprava od servera
    //   onclose — spojenie bolo ukoncene
    //   onerror — chyba spojenia
    CurlingGame.prototype.connect = function (name) {
        var self = this;
        this.playerName = name;

        // Ak uz existuje aktivne spojenie, zavrieme ho
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }

        // Zatvorime pasivne statusWs — hlavne WS bude dostavat online_count
        this.disconnectStatusWs();

        var url = getWsUrl();
        this.ws = new WebSocket(url);

        this.ws.onopen = function () {
            // Posielame meno, obtiaznost a userId — server podla difficulty zaradi do spravneho lobby
            self.send({
                type: 'join',
                name: name,
                difficulty: self.difficulty,
                userId: self.currentUser ? self.currentUser.id : 0
            });
            self.showScreen('lobby');
        };

        this.ws.onmessage = function (event) {
            var data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            self.handleMessage(data);
        };

        this.ws.onclose = function () {
            self.ws = null;
            // Obnovime pasivne statusWs pri neocakavanom odpojeni
            self.connectStatusWs();
            if (self.screen === 'lobby') {
                self.notify('Spojenie bolo prerusene');
                self.showScreen('menu');
            }
        };

        this.ws.onerror = function () {
            self.ws = null;
            self.connectStatusWs();
            self.notify('Chyba pripojenia');
            self.showScreen('menu');
        };
    };

    // Odoslanie JSON spravy na server
    // Vsetky spravy su JSON objekty s property 'type' (napr. 'shoot', 'pause', 'chat')
    CurlingGame.prototype.send = function (data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    };

    // Odpojenie od servera (ked hrac odide z hry)
    CurlingGame.prototype.disconnect = function () {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        // Obnovime pasivne statusWs pre online pocitadlo na menu
        this.connectStatusWs();
    };

    // Router prichadzajucich sprav od servera
    // Podla data.type sa zavola prislusny handler
    CurlingGame.prototype.handleMessage = function (data) {
        switch (data.type) {
            case 'waiting':
                // Server potvrdil ze cakame v lobby — zobrazime stav 1/2
                this.updateLobbyInfo();
                break;
            // Stav lobby (kolko hracov caka v kazdom mode)
            // Server posiela pri kazdom join/disconnect
            case 'lobby_status':
                this.onLobbyStatus(data.lobbies);
                break;
            case 'game_start':
                this.onGameStart(data);
                break;
            case 'turn':
                this.onTurn(data);
                break;
            case 'shoot':
                this.onShoot(data);
                break;
            case 'paused':
                this.onPaused(data);
                break;
            case 'resumed':
                this.onResumed();
                break;
            case 'restart_request':
                // Zobrazi overlay len hracom — divaci nemozu akceptovat restart
                if (!this.isSpectator) this.showOverlay('overlay-restart');
                break;
            case 'restart':
                this.onRestart(data);
                break;
            case 'restart_declined':
                this.notify(this.t('restartDeclined'));
                break;
            case 'game_over':
                this.onGameOver(data);
                break;
            case 'opponent_disconnected':
                this.onOpponentDisconnected(data);
                break;
            case 'chat':
                this.onChat(data);
                break;
            // Systemova udalost divaka — fialova sprava o pripojeni/odpojeni
            // data: { name: 'Meno', action: 'joined'|'left' }
            case 'spectate_event':
                this.onSpectateEvent(data);
                break;
            // Spravi ze este sleduje hru bez aktinej ulohy hraca
            // data: { config, difficulty, currentTurn, stonesLeft, player1, player2 }
            case 'spectate':
                this.onSpectate(data);
                break;
            // Hrac (nie divak) pouzil /cheats — zvacsi jeho kamene o 30%
            // data: { player: 1|2 }
            case 'cheat':
                this.onCheat(data);
                break;
            // Server odmietol spravu divaka kvoli rate limitu (max 1/5s)
            case 'chat_ratelimit':
                this.notify(this.lang === 'sk' ? 'Pockat 5 sekund' : 'Wait 5 seconds');
                break;
            // Aktualizacia poctu pripojenych hracov
            // Server posiela tuto spravu pri kazdom pripojeni/odpojeni klienta
            case 'online_count':
                this.updateOnlineCount(data.count);
                break;
        }
    };

    // =========================================================================
    // HANDLERY SPRAV OD SERVERA
    // =========================================================================

    // =========================================================================
    // LOBBY STATUS — zobrazenie stavu lobby (kolko hracov caka v kazdom mode)
    // =========================================================================
    // Server posiela { type: 'lobby_status', lobbies: { easy: 0|1|2, hard: 0|1|2 } }
    // 0 = prazdne, 1 = caka jeden hrac, 2 = hra prebieha (moznost sledovat)
    // pri kazdom join/disconnect. Aktualizujeme:
    //   1. Indikatory na menu obrazovke (pod difficulty tlacidlami)
    //   2. Lobby obrazovku (ak sme v lobby)
    //   3. Viditelnost tlacidla "Sledovat" (zobrazuje sa ked je 2/2)
    CurlingGame.prototype.onLobbyStatus = function (lobbies) {
        // Ulozime si aktualny stav lobby pre pouzitie v updateLobbyInfo
        this.lobbyStatus = lobbies || { easy: 0, hard: 0 };

        // Aktualizovat indikatory na menu obrazovke
        var easyEl = document.getElementById('lobby-count-easy');
        var hardEl = document.getElementById('lobby-count-hard');
        if (easyEl) easyEl.textContent = this.lobbyStatus.easy + '/2';
        if (hardEl) hardEl.textContent = this.lobbyStatus.hard + '/2';

        // Aktualizovat viditelnost Sledovat tlacidla
        this.updateSpectateButton();

        // Ak sme v lobby, aktualizujeme aj lobby info
        if (this.screen === 'lobby') {
            this.updateLobbyInfo();
        }
    };

    // updateSpectateButton — zobrazi/skryje tlacidlo „Sledovat“ a upravuje stav „Hrat“
    // Logika: ked je pre vybrannu obtiaznost count 2 (hra prebieha) — zobraz Sledovat,
    // prefarbi ho fialovo a skryj normalnu Hrat (slot je obsadeny).
    CurlingGame.prototype.updateSpectateButton = function () {
        var spectateBtn = document.getElementById('btn-spectate');
        var playBtn = document.getElementById('btn-play');
        if (!spectateBtn || !playBtn) return;
        var count = this.lobbyStatus ? (this.lobbyStatus[this.difficulty] || 0) : 0;
        if (count === 2) {
            // Hra uz prebieha — moze len sledovat
            spectateBtn.style.display = '';
            spectateBtn.textContent = this.t('spectate');
            playBtn.style.display = 'none';
        } else {
            // Slot volny / caka hrac — moze hrat
            spectateBtn.style.display = 'none';
            playBtn.style.display = '';
        }
    };

    // Aktualizacia textu na lobby obrazovke — ukazuje mod + pocet hracov
    CurlingGame.prototype.updateLobbyInfo = function () {
        var lobbyMode = document.getElementById('lobby-mode');
        var lobbyCount = document.getElementById('lobby-count');
        if (lobbyMode) {
            lobbyMode.textContent = this.difficulty === 'easy'
                ? this.t('easy') + ' (' + this.t('easyDesc') + ')'
                : this.t('hard') + ' (' + this.t('hardDesc') + ')';
        }
        if (lobbyCount) {
            var count = this.lobbyStatus
                ? this.lobbyStatus[this.difficulty] || 0
                : 0;
            lobbyCount.textContent = count + '/2';
        }
    };

    // game_start — Server sparoval 2 hracov, hra zacina
    // data: { player: 1/2, opponent: 'Meno', config: {...} }
    CurlingGame.prototype.onGameStart = function (data) {
        this.config = data.config;
        this.playerNumber = data.player;
        this.opponentName = data.opponent;
        this.opponentUserId = data.opponentUserId || 0;
        this.gameOver = false;
        this.paused = false;

        document.getElementById('chat-messages').innerHTML = '';
        this.initPhysics();
        this.showScreen('game');

        // Zobrazenie pause/restart tlacidiel pre hracov
        var gameControls = document.getElementById('game-controls');
        if (gameControls) gameControls.style.display = '';

        this.notify(this.t('gameStarted') + data.player);
        this.addChatSystem(this.t('gameStarted') + data.player + '. ' + this.t('opponentName') + data.opponent);
    };

    // turn — Server oznamuje kto je na tahu
    // data: { currentPlayer: 1/2, stonesLeft: { 1: N, 2: N } }
    CurlingGame.prototype.onTurn = function (data) {
        this.currentTurn = data.currentPlayer;
        this.stonesLeft = data.stonesLeft;
        this.waitingForStop = false;
        this.shotSent = false;

        var turnName;
        if (this.isSpectator) {
            // Divak nikdy nehraje — phantom kamen sa nezobrazuje
            this.isMyTurn = false;
            this.showPhantom = false;
            turnName = data.currentPlayer === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name;
        } else {
            this.isMyTurn = (data.currentPlayer === this.playerNumber);
            if (this.isMyTurn && this.stonesLeft[this.playerNumber] > 0) {
                this.showPhantom = true;
            } else {
                this.showPhantom = false;
            }
            turnName = (data.currentPlayer === this.playerNumber) ? this.playerName : this.opponentName;
        }

        // Log turn to chat
        this.addChatEvent(this.t('turnLog') + data.currentPlayer + ' (' + turnName + ')', 'turn');

        this.updateHUD();
    };

    // shoot — Niekto vystrelil kamen (moze byt ja alebo super)
    // data: { vx, vy, player }
    // *** KLUCOVA SYNCHRONIZACIA ***
    // Obaja klienti dostavaju ROVNAKY vektor (vx, vy) a vytvaraju kamen
    // na ROVNAKEJ startovej pozicii. Preto fizika na oboch stranach bezi ROVNAKO.
    CurlingGame.prototype.onShoot = function (data) {
        this.showPhantom = false;
        this.isAiming = false;
        this.aimCurrent = null;
        this.isMyTurn = false;
        this.shotSent = false;

        var start = this.getStartPosition();
        // Ak je aktívny cheat pre tohto hraca, nove kamene su o 30% vacsie
        var sr = this.config.stoneRadius * (this.cheatScale[data.player] || 1.0);

        this.stoneCounter[data.player]++;
        var stoneNum = this.stoneCounter[data.player];

        var body = Bodies.circle(start.x, start.y, sr, {
            frictionAir: this.config.friction,
            restitution: 0.7,
            friction: 0.05,
            density: 0.004,
            label: 'stone_p' + data.player
        });

        Body.setVelocity(body, { x: data.vx, y: data.vy });
        World.add(this.engine.world, body);

        this.stones.push({ body: body, player: data.player, num: stoneNum });
        this.lastShotBody = body;
        this.waitingForStop = true;
        this.stoppedCount = 0;

        // Log shot to chat — urcenie mena strielca (rozdielne pre hraca a divaka)
        var shooterName;
        if (this.isSpectator) {
            shooterName = data.player === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name;
        } else {
            shooterName = (data.player === this.playerNumber) ? this.playerName : this.opponentName;
        }
        this.addChatEvent(shooterName + this.t('shotLog') + data.player + '.' + stoneNum, 'shot');

        this.updateHUD();
    };

    // paused — Server oznamuje ze hra bola pozastavena (hracom na tahu)
    // Zobrazi overlay s tlacidlom "Pokracovat" a aktualizuje HUD
    // Divaci overlay nevidia — HUD im ukaze "Pauza" v stredovom indikatore
    CurlingGame.prototype.onPaused = function (data) {
        this.paused = true;
        if (!this.isSpectator) this.showOverlay('overlay-pause');
        this.updateHUD();
    };

    // resumed — Server oznamuje ze pauza bola zrusena
    // Skryje overlay, obnovi stav a notifikuje hraca
    CurlingGame.prototype.onResumed = function () {
        this.paused = false;
        this.hideOverlay('overlay-pause');
        this.updateHUD();
        this.notify(this.t('continues'));
    };

    // restart — Server potvrdil restart hry (obaja suhlasili)
    // Resetuje cely stav, nacita novy config, vymaze chat
    CurlingGame.prototype.onRestart = function (data) {
        this.hideAllOverlays();
        this.config = data.config;
        this.gameOver = false;
        this.paused = false;
        this.cheatScale = { 1: 1.0, 2: 1.0 };  // Reset cheat stavu — nove kolo
        this.resetGame();
        this.notify(this.t('gameRestarted'));
        document.getElementById('chat-messages').innerHTML = '';
        this.addChatSystem(this.t('gameRestarted'));
    };

    // game_over — Koniec hry, server poslal vitaza a vzdialenosti
    // Zobrazi overlay s vysledkom (vyhral/prehral/remiza) a vzdialenostami od ciela
    CurlingGame.prototype.onGameOver = function (data) {
        this.gameOver = true;
        this.waitingForStop = false;

        var title = '';
        if (data.winner === 0) {
            title = this.t('draw');
        } else if (this.isSpectator) {
            // Divak — zobrazujeme meno vitaza (nie "Vyhral si")
            var winnerName = data.winner === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name;
            title = winnerName + this.t('playerWins');
        } else if (data.winner === this.playerNumber) {
            title = this.t('youWin');
        } else {
            title = this.t('youLose');
        }

        document.getElementById('gameover-title').textContent = title;

        var d1 = data.distances[1] === Infinity ? '---' : data.distances[1] + ' px';
        var d2 = data.distances[2] === Infinity ? '---' : data.distances[2] + ' px';

        // Urcenie mien hracov pre zobrazenie vzdialenosti od ciela
        var n1, n2;
        if (this.isSpectator) {
            n1 = this.spectatorPlayer1Name;
            n2 = this.spectatorPlayer2Name;
        } else {
            n1 = this.playerNumber === 1 ? this.playerName : this.opponentName;
            n2 = this.playerNumber === 2 ? this.playerName : this.opponentName;
        }

        document.getElementById('gameover-details').textContent =
            n1 + ': ' + d1 + '  |  ' + n2 + ': ' + d2;

        this.showOverlay('overlay-gameover');
        this.updateHUD();

        // Zaznamenanie vysledku hry do DB — len hrac 1 posiela (zabranuje duplicite)
        if (!this.isSpectator && this.playerNumber === 1 && this.currentUser) {
            this.recordGameResult(data);
        }

        // Po konci hry aktualizuj leaderboard
        var self = this;
        setTimeout(function () { self.fetchLeaderboard(); }, 1500);
    };

    // recordGameResult — POST na PHP API /api/stats.php?action=record_game
    // AKO TO FUNGUJE:
    //   1. Vola sa z onGameOver() a onOpponentDisconnected()
    //   2. LEN HRAC 1 posiela (zabranuje dvojitemu zapisu — keby obaja poslali, bol by kazdy zapas 2x)
    //   3. Posle JSON { winner_id, loser_id, is_draw } na /api/stats.php
    //   4. PHP aktualizuje tabulku users: winner +1 win, loser +1 loss, obaja +1 game
    //   5. Ak is_draw === true → obaja dostavaju +1 draws
    //   6. Aktualizuje aj globalny pocet hier v tabulke game_stats
    CurlingGame.prototype.recordGameResult = function (data) {
        var myId = this.currentUser ? this.currentUser.id : 0;
        var opponentId = this.opponentUserId || 0;

        // Overenie IDs z game_over spravy (obsahuje player1UserId a player2UserId)
        var p1Id = data.player1UserId || (this.playerNumber === 1 ? myId : opponentId);
        var p2Id = data.player2UserId || (this.playerNumber === 2 ? myId : opponentId);

        if (!p1Id || !p2Id) return;

        var isDraw = data.winner === 0;
        var winnerId = isDraw ? p1Id : (data.winner === 1 ? p1Id : p2Id);
        var loserId = isDraw ? p2Id : (data.winner === 1 ? p2Id : p1Id);

        fetch(getApiBase() + '/stats.php?action=record_game', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                winner_id: winnerId,
                loser_id: loserId,
                is_draw: isDraw
            })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            console.log('Game result recorded:', res);
        }).catch(function (e) {
            console.error('Failed to record game result:', e);
        });
    };

    // opponent_disconnected — Super sa odpojil (zavrel prehliadac, stratil internet)
    // Ukonci hru a zobrazi informacny overlay s tlacidlom OK
    CurlingGame.prototype.onOpponentDisconnected = function (data) {
        this.gameOver = true;
        this.hideAllOverlays();
        this.showOverlay('overlay-disconnect');

        // Zaznamenanie vysledku — ak server poslal winner info a ja nie som divak
        if (!this.isSpectator && this.currentUser && data && data.winner) {
            this.recordGameResult(data);
        }

        // Refresh leaderboard
        var self = this;
        setTimeout(function () { self.fetchLeaderboard(); }, 1500);
    };

    // onSpectateEvent — server oznamuje ze sa divak pripojil alebo odpojil
    // Zobrazi fialovu systemovu spravu do chatu pre vsetkych v room
    CurlingGame.prototype.onSpectateEvent = function (data) {
        var msg = data.name + this.t(data.action === 'joined' ? 'spectatorJoined' : 'spectatorLeft');
        this.addChatSpectatorSystem(msg);
    };

    // addChatSpectatorSystem — prida fialovu systemovu spravu do chatu
    // Pouziva sa pre oznamy o pripojeni/odpojeni divaka
    CurlingGame.prototype.addChatSpectatorSystem = function (text) {
        var container = document.getElementById('chat-messages');
        if (!container) return;
        var div = document.createElement('div');
        div.className = 'chat-msg-spectator-system';
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    };

    // =========================================================================
    // SPECTATE — sledovanie prebiehajucej hry ako divak
    // =========================================================================

    // onSpectate — server nás priradil ako divaka k prebiehajucej hre
    // data: { config, difficulty, currentTurn, stonesLeft, player1, player2 }
    // Inicializuje fyziku a zobrazi hernú obrazovku.
    // Divaci vidia kamene az od dalsieho vystrelu (server neposiela historiu pozicii).
    CurlingGame.prototype.onSpectate = function (data) {
        this.config = data.config;
        this.difficulty = data.difficulty;
        this.isSpectator = true;
        this.playerNumber = 0;          // Divaci nemaju cislo hraca
        this.playerName = '';
        this.opponentName = '';
        this.spectatorPlayer1Name = data.player1;
        this.spectatorPlayer2Name = data.player2;
        this.currentTurn = data.currentTurn;
        this.stonesLeft = data.stonesLeft;
        this.gameOver = false;
        this.paused = false;
        this.cheatScale = { 1: 1.0, 2: 1.0 };

        document.getElementById('chat-messages').innerHTML = '';
        this.initPhysics();
        this.showScreen('game');

        // Skrytie pause/restart tlacidiel pre divakov
        var gameControls = document.getElementById('game-controls');
        if (gameControls) gameControls.style.display = 'none';

        // Replay vsetkych predchadzajucich vystrolov — divak uivi vsetky kamene
        if (data.shotHistory && data.shotHistory.length > 0) {
            for (var i = 0; i < data.shotHistory.length; i++) {
                this.replayShot(data.shotHistory[i]);
            }
            // Po replay spustime simulaciu na chvilu aby kamene dosli na finale pozicie
            this.runReplaySimulation();
        }

        // Pridanie vizualneho odznaku "SPECTATOR" do HUD
        this.addSpectatorBadge();
        this.updateHUD();

        // Informacna sprava do chatu o divackom mode
        this.addChatSystem(
            (this.lang === 'sk' ? 'Sledujete hru ako divak' : 'You are watching as spectator') +
            ' | ' + data.player1 + ' vs ' + data.player2
        );
        this.notify(this.lang === 'sk' ? 'Spektatorsky mod' : 'Spectator mode');
    };

    // replayShot — replay jedneho vystrelu pre divaka (bez animacie)
    CurlingGame.prototype.replayShot = function (shot) {
        var start = this.getStartPosition();
        var sr = this.config.stoneRadius * (this.cheatScale[shot.player] || 1.0);

        this.stoneCounter[shot.player]++;
        var stoneNum = this.stoneCounter[shot.player];

        var body = Bodies.circle(start.x, start.y, sr, {
            frictionAir: this.config.friction,
            restitution: 0.7,
            friction: 0.05,
            density: 0.004,
            label: 'stone_p' + shot.player
        });

        Body.setVelocity(body, { x: shot.vx, y: shot.vy });
        World.add(this.engine.world, body);
        this.stones.push({ body: body, player: shot.player, num: stoneNum });
    };

    // runReplaySimulation — spusti rychlu simulaciu aby kamene dosli na finale pozicie
    CurlingGame.prototype.runReplaySimulation = function () {
        // Simulujeme 600 framov (10 sekund pri 60fps) — dost na zastavenie kamenov
        for (var i = 0; i < 600; i++) {
            Engine.update(this.engine, 1000 / 60);
        }
        // Zastavime vsetky kamene uplne
        for (var j = 0; j < this.stones.length; j++) {
            Body.setVelocity(this.stones[j].body, { x: 0, y: 0 });
            Body.setAngularVelocity(this.stones[j].body, 0);
        }
    };

    // addSpectatorBadge — prida "SPECTATOR" odznak do stredu HUD
    // Vizualne odlisi divaka od hraca (neduplije odznak pri opakovanom volani)
    CurlingGame.prototype.addSpectatorBadge = function () {
        var hudCenter = document.getElementById('hud-center');
        if (!hudCenter || document.getElementById('hud-spectator-badge')) return;
        var badge = document.createElement('div');
        badge.id = 'hud-spectator-badge';
        badge.textContent = 'SPECTATOR';
        hudCenter.appendChild(badge);
    };

    // =========================================================================
    // CHEAT — prikaz /cheats zvacsi kamene hraca o 30%
    // =========================================================================

    // onCheat — hrac pouzil /cheats, zvacsi vsetky existujuce kamene o 30%
    // data: { player: 1|2 }
    // Pouziva Matter.Body.scale() — ten aktualizuje aj circleRadius tela.
    // Pre nove kamene vystrielene neskor sa pouzije cheatScale faktor v onShoot().
    // onCheat — hrac pouzil /cheats alebo /cheatss
    // data.revert === false → zvacsi kamene o CHEAT_SCALE (napr. 1.3 = +30%)
    // data.revert === true  → vrati kamene na povodnu velkost
    // *** Chces zmenit efekt? Zmen konstantu CHEAT_SCALE na zaciatku suboru ***
    CurlingGame.prototype.onCheat = function (data) {
        var player = data.player;
        var revert = data.revert === true;

        if (revert) {
            // Navratenie kamenov na povodnu velkost — scale 1/CHEAT_SCALE
            this.cheatScale[player] = 1.0;
            var factor = 1 / CHEAT_SCALE;  // Napr. 1/1.3 ≈ 0.769
            for (var i = 0; i < this.stones.length; i++) {
                if (this.stones[i].player === player) {
                    Matter.Body.scale(this.stones[i].body, factor, factor);
                }
            }
            var pNameR = this.isSpectator
                ? (player === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name)
                : (player === this.playerNumber ? this.playerName : this.opponentName);
            this.addChatSystem(
                pNameR + (this.lang === 'sk' ? ' deaktivoval cheaty. Kamene su povodne.' : ' deactivated cheats. Stones are back to normal.')
            );
        } else {
            // Aktivacia cheatu — zvacsi vsetky existujuce kamene hraca
            this.cheatScale[player] = CHEAT_SCALE;
            for (var j = 0; j < this.stones.length; j++) {
                if (this.stones[j].player === player) {
                    Matter.Body.scale(this.stones[j].body, CHEAT_SCALE, CHEAT_SCALE);
                }
            }
            var pNameA = this.isSpectator
                ? (player === 1 ? this.spectatorPlayer1Name : this.spectatorPlayer2Name)
                : (player === this.playerNumber ? this.playerName : this.opponentName);
            this.addChatSystem(
                pNameA + (this.lang === 'sk' ? ' aktivoval cheaty! Kamene su o ' + Math.round((CHEAT_SCALE - 1) * 100) + '% vacsie.' : ' activated cheats! Stones are ' + Math.round((CHEAT_SCALE - 1) * 100) + '% bigger.')
            );
        }
    };

    // =========================================================================
    // MATTER.JS FYZIKA — inicializacia engine
    // =========================================================================
    // Vytvara:
    //   - Engine s vypnutou gravitaciou (curling je zhora, nie z boku)
    //   - 4 staticke steny (odrazy kamenov od okrajov)
    //   - Listener na kolizie (pre herny log v chate)
    CurlingGame.prototype.initPhysics = function () {
        var self = this;
        this.engine = Engine.create({
            gravity: { x: 0, y: 0, scale: 0 }
        });

        this.stones = [];
        this.stoneCounter = { 1: 0, 2: 0 };
        this.waitingForStop = false;
        this.stoppedCount = 0;
        this.loggedCollisions = {};

        var fw = this.config.field.width;
        var fh = this.config.field.height;
        var t = 50;

        var wallOpts = { isStatic: true, restitution: 0.8, friction: 0, label: 'wall' };
        var walls = [
            Bodies.rectangle(fw / 2, -t / 2, fw + t * 2, t, wallOpts),
            Bodies.rectangle(fw / 2, fh + t / 2, fw + t * 2, t, wallOpts),
            Bodies.rectangle(-t / 2, fh / 2, t, fh + t * 2, wallOpts),
            Bodies.rectangle(fw + t / 2, fh / 2, t, fh + t * 2, wallOpts)
        ];

        World.add(this.engine.world, walls);

        // Collision events for chat log
        Matter.Events.on(this.engine, 'collisionStart', function (event) {
            var pairs = event.pairs;
            for (var i = 0; i < pairs.length; i++) {
                var a = pairs[i].bodyA;
                var b = pairs[i].bodyB;
                self.logCollision(a, b);
            }
        });
    };

    // Reset hry — vycisti fyzikalny svet a zacne novu simulaciu
    CurlingGame.prototype.resetGame = function () {
        if (this.engine) {
            World.clear(this.engine.world);
            Engine.clear(this.engine);
        }
        this.stones = [];
        this.showPhantom = false;
        this.isAiming = false;
        this.aimCurrent = null;
        this.waitingForStop = false;
        this.stoppedCount = 0;
        this.shotSent = false;
        this.initPhysics();
    };

    CurlingGame.prototype.getStoneLabel = function (body) {
        for (var i = 0; i < this.stones.length; i++) {
            if (this.stones[i].body === body) {
                return { player: this.stones[i].player, num: this.stones[i].num };
            }
        }
        return null;
    };

    // Detekcia kolizie medzi dvoma telesami (volana Matter.js Events)
    // Rozlisuje: kamen-kamen, kamen-stena
    // Pouziva lastShotBody pre urcenie "utocnika" (pohybujuci sa kamen)
    CurlingGame.prototype.logCollision = function (bodyA, bodyB) {
        var stoneA = this.getStoneLabel(bodyA);
        var stoneB = this.getStoneLabel(bodyB);
        var isWallA = bodyA.label === 'wall';
        var isWallB = bodyB.label === 'wall';

        // Deduplicate collisions within short time
        var key = bodyA.id + '_' + bodyB.id;
        var now = Date.now();
        if (this.loggedCollisions[key] && now - this.loggedCollisions[key] < 500) return;
        this.loggedCollisions[key] = now;

        if (stoneA && stoneB) {
            // Make the moving (last shot) stone be first
            var attacker = stoneA;
            var target = stoneB;
            if (this.lastShotBody === bodyB) {
                attacker = stoneB;
                target = stoneA;
            }
            var msg = this.t('collisionLog')
                .replace('%a', attacker.player + '.' + attacker.num)
                .replace('%b', target.player + '.' + target.num);
            this.addChatEvent(msg, 'collision');
        } else if (stoneA && isWallB) {
            var msg2 = this.t('wallBounce').replace('%a', stoneA.player + '.' + stoneA.num);
            this.addChatEvent(msg2, 'wall');
        } else if (stoneB && isWallA) {
            var msg3 = this.t('wallBounce').replace('%a', stoneB.player + '.' + stoneB.num);
            this.addChatEvent(msg3, 'wall');
        }
    };

    // Pridanie hernej udalosti do chatu (turn, shot, collision, wall)
    // Kazdy typ ma iny vizualny styl (farba, icon, pozadie)
    CurlingGame.prototype.addChatEvent = function (text, type) {
        var container = document.getElementById('chat-messages');
        var div = document.createElement('div');
        div.className = 'chat-event';
        if (type === 'collision') {
            div.className += ' event-collision';
        } else if (type === 'wall') {
            div.className += ' event-wall';
        } else if (type === 'turn') {
            div.className += ' event-turn';
        } else if (type === 'shot') {
            div.className += ' event-shot';
        }
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    };

    // Startovacia pozicia kamena — stred dole na hracej ploche
    CurlingGame.prototype.getStartPosition = function () {
        return {
            x: this.config.field.width / 2,
            y: this.config.field.height - this.config.stoneRadius - 80
        };
    };

    // Kontrola ci sa vsetky kamene zastavili
    // Ak VSETKY kamene maju rychlost pod SPEED_THRESHOLD po dobu STOPPED_FRAMES framov,
    // zastavi ich uplne (velocity=0) a posle serveru stones_stopped s poziciami.
    // *** SYNCHRONIZACIA: OBAJA klienti posilaju stones_stopped ***
    // Server caka kym obaja hlasiia stop, az potom posle dalsi turn.
    // Toto zabranuje situacii kde rychlejsi pocitac dokonci simulaciu skor
    // a hrac by mohol strielat kym super este vidi pohybujuce kamene.
    CurlingGame.prototype.checkStopped = function () {
        if (!this.waitingForStop || this.stones.length === 0) return;

        var allSlow = true;
        for (var i = 0; i < this.stones.length; i++) {
            var v = this.stones[i].body.velocity;
            var speed = Math.sqrt(v.x * v.x + v.y * v.y);
            if (speed >= SPEED_THRESHOLD) {
                allSlow = false;
                break;
            }
        }

        if (allSlow) {
            this.stoppedCount++;
            if (this.stoppedCount >= STOPPED_FRAMES) {
                for (var j = 0; j < this.stones.length; j++) {
                    Body.setVelocity(this.stones[j].body, { x: 0, y: 0 });
                    Body.setAngularVelocity(this.stones[j].body, 0);
                }

                this.waitingForStop = false;
                this.addChatEvent(this.t('stonesStopped'), 'turn');

                // Len hraci posilaju stones_stopped serveru — divaci len sleduju, nesynchronizuju
                if (!this.isSpectator) {
                    // Obaja hraci posilaju stones_stopped serveru
                    // Server caka na oboch a az potom posle dalsi tah
                    var positions = [];
                    for (var k = 0; k < this.stones.length; k++) {
                        positions.push({
                            player: this.stones[k].player,
                            x: this.stones[k].body.position.x,
                            y: this.stones[k].body.position.y
                        });
                    }
                    this.send({ type: 'stones_stopped', positions: positions });
                }
            }
        } else {
            this.stoppedCount = 0;
        }
    };

    // =========================================================================
    // CANVAS — nastavenie platna a responsivita
    // =========================================================================
    // Canvas sa nastavi ked hrac prejde na hernu obrazovku.
    // Registruje myš a touch udalosti pre slingshot ovládanie.
    // resize() sa vola pri zmene velkosti okna — prepocita scale a offset
    // aby hracia plocha bola vzdy centrovana a vyplnila dostupny priestor.
    CurlingGame.prototype.setupCanvas = function () {
        var self = this;
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.canvas.addEventListener('mousedown', function (e) {
            self.onMouseDown(e);
        });
        window.addEventListener('mousemove', function (e) {
            self.onMouseMove(e);
        });
        window.addEventListener('mouseup', function (e) {
            self.onMouseUp(e);
        });

        // =========================================================================
        // TOUCH PODPORA — jednoprstove gesto (mierenie) + dvojprstove (pinch zoom)
        // =========================================================================
        // touchstart: ak 1 prst → zaciatok mierenia, ak 2 prsty → zaciatok zoomu
        // touchmove: ak 1 prst → posun mierenia, ak 2 prsty → zmena zoomu
        // touchend: ak 0 prstov → vystrel, reset zoomu pri poslednom zdvihnuti
        this.canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            if (e.touches.length === 2) {
                // Zaciatok pinch-to-zoom gesta — zapamatame vzdialenost medzi prstami
                // a aktualny zoom, aby sme mohli pocitat relativnu zmenu
                var dx = e.touches[0].clientX - e.touches[1].clientX;
                var dy = e.touches[0].clientY - e.touches[1].clientY;
                self.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                self.pinchStartZoom = self.userZoom;
                // Stred medzi dvoma prstami = bod okolo ktoreho zoomujeme
                var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                var vp = self.screenToVirtual(midX, midY);
                self.zoomCenterX = vp.x;
                self.zoomCenterY = vp.y;
                // Zrusenie mierenia ak bolo aktivne (hrac pridal druhy prst)
                self.isAiming = false;
            } else if (e.touches.length === 1) {
                var t = e.touches[0];
                self.onMouseDown({ clientX: t.clientX, clientY: t.clientY });
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            if (e.touches.length === 2 && self.pinchStartDist > 0) {
                // Pinch-to-zoom: vypocet noveho zoomu podla pomeru vzdialenosti prstov
                var dx = e.touches[0].clientX - e.touches[1].clientX;
                var dy = e.touches[0].clientY - e.touches[1].clientY;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var ratio = dist / self.pinchStartDist;
                self.userZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, self.pinchStartZoom * ratio));
            } else if (e.touches.length === 1) {
                var t = e.touches[0];
                self.onMouseMove({ clientX: t.clientX, clientY: t.clientY });
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', function (e) {
            e.preventDefault();
            if (e.touches.length === 0) {
                // Vsetky prsty zdvihnute
                self.pinchStartDist = 0;
                self.onMouseUp({});
            } else if (e.touches.length === 1) {
                // Zostal 1 prst — reset pinch stavu, necháme mierenie
                self.pinchStartDist = 0;
            }
        }, { passive: false });

        // =========================================================================
        // RESIZE + ROTACIA ZARIADENIA
        // =========================================================================
        // Pri zmene orientacie (portrait ↔ landscape) prehliadac prepocita rozmery
        // ale nie hned — pouzivame debounce (oneskorenie 300ms) aby sme dostali
        // stabilne rozmery a nevolali resize 10x pocas animacie rotacie.
        var resizeTimeout = null;
        function debouncedResize() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                self.resize();
            }, 300);
        }
        window.addEventListener('resize', debouncedResize);
        // orientationchange je specificky pre mobilne zariadenia
        // Niektore prehliadace vyrobia resize aj orientationchange, preto debounce
        window.addEventListener('orientationchange', function () {
            // Reset zoomu pri zmene orientacie — nech sa plocha cela zobrazi
            self.userZoom = 1.0;
            debouncedResize();
        });

        this.resize();
    };

    // Responsivne preskalovanie — hracia plocha sa prispôsobí velkosti okna
    // Vypocita scale faktor a offset pre centrovanie.
    // userZoom sa aplikuje navrch base scale — umoznuje pinch-to-zoom na mobile.
    // Parameter skipResize: ak true, neprepise canvas rozmery (pouziva sa v render loop)
    CurlingGame.prototype.resize = function (skipResize) {
        if (!this.canvas) return;

        var area = document.getElementById('game-area');
        if (!area) return;
        var w = area.clientWidth;
        var h = area.clientHeight;

        if (!skipResize) {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        if (!this.config) return;

        var fw = this.config.field.width;
        var fh = this.config.field.height;

        var scaleX = w / fw;
        var scaleY = h / fh;
        // Base scale = fit-to-container s 6% paddingom
        var baseScale = Math.min(scaleX, scaleY) * 0.94;
        // Aplikovanie user zoomu (pinch-to-zoom)
        this.scale = baseScale * this.userZoom;

        // Centrovanie hracej plochy
        this.offsetX = (w - fw * this.scale) / 2;
        this.offsetY = (h - fh * this.scale) / 2;

        // Pri zoome posunieme offset tak aby zoom centrum zostalo fixne
        if (this.userZoom > 1.0) {
            var baseCX = (w - fw * baseScale) / 2 + this.zoomCenterX * baseScale;
            var baseCY = (h - fh * baseScale) / 2 + this.zoomCenterY * baseScale;
            var zoomedCX = this.offsetX + this.zoomCenterX * this.scale;
            var zoomedCY = this.offsetY + this.zoomCenterY * this.scale;
            this.offsetX += baseCX - zoomedCX;
            this.offsetY += baseCY - zoomedCY;
        }
    };

    // Prevod suradnic obrazovky (pixelovy klik) na virtualne suradnice hracej plochy
    // Canvas moze byt zvacseny/zmenseny (scale) a posunuty (offset)
    CurlingGame.prototype.screenToVirtual = function (clientX, clientY) {
        var rect = this.canvas.getBoundingClientRect();
        var cx = clientX - rect.left;
        var cy = clientY - rect.top;
        return {
            x: (cx - this.offsetX) / this.scale,
            y: (cy - this.offsetY) / this.scale
        };
    };

    // =========================================================================
    // VSTUPNA LOGIKA — Slingshot mechanika (prak)
    // =========================================================================
    // Ovladanie funguje nasledovne:
    //   1. mousedown na fantomovom kameni → zaciatok mierenia
    //   2. mousemove → aktualizacia pozicie kurzora (ciara sa kresli)
    //   3. mouseup → vypocet vektora rychlosti a odoslanie serveru
    //
    // Sila vystrelu = vzdialenost tahu / MAX_DRAG (max 100%)
    // Smer vystrelu = OPACNY smer tahu (tiahnete dozadu, kamen leti dopredu)
    // Smer sa pocita cez atan2(-dy, -dx) — minus preto, ze hrac tiahne OD ciela
    CurlingGame.prototype.onMouseDown = function (e) {
        if (!this.isMyTurn || this.paused || this.waitingForStop || this.gameOver || this.shotSent) return;
        if (!this.showPhantom) return;

        var pos = this.screenToVirtual(e.clientX, e.clientY);
        var start = this.getStartPosition();
        var sr = this.config.stoneRadius;

        var dx = pos.x - start.x;
        var dy = pos.y - start.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= sr * 2) {
            this.isAiming = true;
            this.aimCurrent = pos;
        }
    };

    CurlingGame.prototype.onMouseMove = function (e) {
        if (!this.isAiming) return;
        this.aimCurrent = this.screenToVirtual(e.clientX, e.clientY);
    };

    // Pustenie mysi — vystreli kamen
    // Vypocita vektor rychlosti z dragnutia a posle serveru
    CurlingGame.prototype.onMouseUp = function () {
        if (!this.isAiming) return;
        this.isAiming = false;

        if (!this.aimCurrent) {
            return;
        }

        var start = this.getStartPosition();
        var dx = this.aimCurrent.x - start.x;
        var dy = this.aimCurrent.y - start.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        this.aimCurrent = null;

        if (dist < 15) {
            return;
        }

        var force = Math.min(dist / MAX_DRAG, 1.0);
        var speed = force * this.config.maxForce;
        var angle = Math.atan2(-dy, -dx);

        var vx = Math.cos(angle) * speed;
        var vy = Math.sin(angle) * speed;

        this.shotSent = true;
        this.showPhantom = false;
        this.send({ type: 'shoot', vx: vx, vy: vy });
    };

    // =========================================================================
    // Game actions
    // =========================================================================
    CurlingGame.prototype.togglePause = function () {
        if (this.gameOver) return;
        if (this.paused) {
            this.send({ type: 'resume' });
        } else {
            if (this.currentTurn === this.playerNumber) {
                this.send({ type: 'pause' });
            } else {
                this.notify(this.t('pauseOnly'));
            }
        }
    };

    CurlingGame.prototype.requestRestart = function () {
        this.send({ type: 'restart_request' });
        this.notify(this.t('restartSent'));
    };

    // =========================================================================
    // Chat
    // =========================================================================
    // sendChat — odoslanie chatovej spravy pri kliknuti na tlacidlo alebo Enter
    // Hraci posilaju typ 'chat', divaci posilaju typ 'spectate_chat' (rate-limit 1/5s)
    CurlingGame.prototype.sendChat = function () {
        var input = document.getElementById('chat-input');
        var text = input.value.trim();
        if (!text) return;

        if (this.isSpectator) {
            // Divaci: klientsky rate-limit (5s) pre lepsie UX pred serverovym rate-limitom
            if (this.spectatorCooldown) return;
            this.send({ type: 'spectate_chat', text: text });
            input.value = '';
            // Deaktivacia send tlacidla na 5 sekund
            var self = this;
            var sendBtn = document.getElementById('btn-send');
            this.spectatorCooldown = true;
            if (sendBtn) sendBtn.disabled = true;
            setTimeout(function () {
                self.spectatorCooldown = false;
                if (sendBtn) sendBtn.disabled = false;
            }, 5000);
        } else {
            // Hraci: standardny chat bez rate-limitu
            this.send({ type: 'chat', text: text });
            input.value = '';
        }
    };

    // onChat — server preposla chatovu spravu (od hraca alebo divaka)
    // data.spectator === true → sprava od divaka (fialova farba, predpona "Spectator")
    CurlingGame.prototype.onChat = function (data) {
        this.addChatMessage(data.name, data.text, data.player, data.spectator === true);
    };

    // addChatMessage — prida spravu hraca alebo divaka do chat panela
    // isSpectator: true → fialova farba, predpona "Spectator"; false → farba podla hraca
    CurlingGame.prototype.addChatMessage = function (name, text, player, isSpectator) {
        var container = document.getElementById('chat-messages');
        var div = document.createElement('div');
        div.className = 'chat-msg';

        var nameSpan = document.createElement('span');
        if (isSpectator) {
            // Divak — fialova farba, predpona "Spectator" odlisi od hracov
            nameSpan.className = 'chat-name spectator';
            nameSpan.textContent = 'Spectator ' + name + ':';
        } else {
            nameSpan.className = 'chat-name p' + player;
            nameSpan.textContent = name + ':';
        }

        var textSpan = document.createElement('span');
        textSpan.className = 'chat-text';
        textSpan.textContent = ' ' + text;

        div.appendChild(nameSpan);
        div.appendChild(textSpan);
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    };

    CurlingGame.prototype.addChatSystem = function (text) {
        var container = document.getElementById('chat-messages');
        var div = document.createElement('div');
        div.className = 'chat-msg-system';
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    };

    // =========================================================================
    // ONLINE POCITADLO — aktualizacia indikatora pripojenych hracov
    // =========================================================================
    // Server posiela { type: 'online_count', count: N } pri kazdom connect/disconnect.
    // Aktualizujeme vsetky indikatory (globalny v menu + v chat headeri).
    CurlingGame.prototype.updateOnlineCount = function (count) {
        // Hlavny indikator (globalny — menu, lobby)
        var el = document.getElementById('online-count');
        if (el) el.textContent = count;
        // Mirror indikator (v chat headeri pocas hry)
        var mirrors = document.querySelectorAll('.online-count-mirror');
        for (var i = 0; i < mirrors.length; i++) {
            mirrors[i].textContent = count;
        }
    };

    // =========================================================================
    // AUTH — kontrola session, prihlasenie, registracia, guest
    // =========================================================================

    // checkSession — kontrola ci je uzivatel uz prihlaseny (existujuca PHP session)
    // AKO TO FUNGUJE:
    //   1. Pri kazdom nacitani stranky sa posle GET request na /api/auth.php?action=me
    //   2. PHP skontroluje ci existuje session (cookie PHPSESSID)
    //   3. Ak ano → dostaneme { user: { id, username, is_guest, is_admin } } → ideme na menu
    //   4. Ak nie → zostaneme na prihlasovaciej obrazovke
    //   5. Ak data.kicked === true → niekto iny sa prihlasil s tymto uctom na inom zariadeni
    //      → odhlasime uzivatela a zobrazime hlasenie
    CurlingGame.prototype.checkSession = function () {
        var self = this;
        fetch(getApiBase() + '/auth.php?action=me', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.kicked) {
                    // Niekto iny sa prihlasil s tymto uctom
                    self.currentUser = null;
                    self.stopLobbyChat();
                    self.showScreen('auth');
                    document.getElementById('auth-error').textContent = self.t('sessionKicked');
                } else if (data.user) {
                    self.currentUser = data.user;
                    self.onAuthSuccess();
                }
            })
            .catch(function () { /* zostane na auth obrazovke */ });
    };

    // setupAuthUI — registracia listenerov pre auth obrazovku
    // Tato funkcia priradi click/keydown handlery pre:
    //   - Login tab (prepnutie medzi login/register formulárom)
    //   - Login tlacidlo + Enter v input poliach → doLogin()
    //   - Register tlacidlo + Enter → doRegister()
    //   - Guest tlacidlo → doGuest() (vytvorenie docasneho guest uctu)
    //   - Logout tlacidlo → doLogout()
    //   - Lobby chat: odoslanie spravy, otvorenie/zatvorenie panelu
    //   - Menu leaderboard: otvorenie/zatvorenie panelu
    CurlingGame.prototype.setupAuthUI = function () {
        var self = this;

        // Auth tabs — prepinanie login/register
        var tabs = document.querySelectorAll('.auth-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function () {
                for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
                this.classList.add('active');
                var tab = this.getAttribute('data-tab');
                document.getElementById('auth-form-login').style.display = tab === 'login' ? '' : 'none';
                document.getElementById('auth-form-register').style.display = tab === 'register' ? '' : 'none';
            });
        }

        // Login
        document.getElementById('btn-login').addEventListener('click', function () {
            self.doLogin();
        });
        document.getElementById('auth-username').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') self.doLogin();
        });
        document.getElementById('auth-password').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') self.doLogin();
        });

        // Register
        document.getElementById('btn-register').addEventListener('click', function () {
            self.doRegister();
        });
        document.getElementById('reg-username').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') self.doRegister();
        });
        document.getElementById('reg-password').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') self.doRegister();
        });

        // Guest
        document.getElementById('btn-guest').addEventListener('click', function () {
            self.doGuest();
        });

        // Logout
        document.getElementById('btn-logout').addEventListener('click', function () {
            self.doLogout();
        });

        // Lobby chat send
        document.getElementById('btn-lobby-chat-send').addEventListener('click', function () {
            self.sendLobbyChat();
        });
        document.getElementById('lobby-chat-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') self.sendLobbyChat();
        });

        // Close lobby chat panel
        document.getElementById('btn-close-lobby-chat').addEventListener('click', function () {
            document.getElementById('lobby-chat-panel').style.display = 'none';
            document.getElementById('btn-open-lobby-chat').style.display = '';
        });
        document.getElementById('btn-open-lobby-chat').addEventListener('click', function () {
            document.getElementById('lobby-chat-panel').style.display = '';
            document.getElementById('btn-open-lobby-chat').style.display = 'none';
        });

        // Close/open menu leaderboard panel
        document.getElementById('btn-close-menu-lb').addEventListener('click', function () {
            document.getElementById('menu-leaderboard').style.display = 'none';
            document.getElementById('btn-open-menu-lb').style.display = '';
        });
        document.getElementById('btn-open-menu-lb').addEventListener('click', function () {
            document.getElementById('menu-leaderboard').style.display = '';
            document.getElementById('btn-open-menu-lb').style.display = 'none';
        });
    };

    // doLogin — odoslanie login requestu na PHP API
    // AKO TO FUNGUJE:
    //   1. Zoberie username a password z input policok
    //   2. Posle POST request na /api/auth.php?action=login s JSON telom { username, password }
    //   3. PHP overi heslo proti databaze (bcrypt hash)
    //   4. Ak je spravne → vrati { ok: true, user: { id, username, ... } }
    //      → ulozime do this.currentUser a ideme na menu
    //   5. Ak nie → zobrazime chybovu hlasku pod formularom
    //   credentials: 'include' = posielame cookies (PHPSESSID) → PHP vie kto sme
    CurlingGame.prototype.doLogin = function () {
        var self = this;
        var username = document.getElementById('auth-username').value.trim();
        var password = document.getElementById('auth-password').value;
        if (!username || !password) return;

        fetch(getApiBase() + '/auth.php?action=login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
            if (res.ok && res.data.ok) {
                self.currentUser = res.data.user;
                self.onAuthSuccess();
            } else {
                document.getElementById('auth-error').textContent = res.data.error || 'Chyba';
            }
        })
        .catch(function () {
            document.getElementById('auth-error').textContent = 'Chyba pripojenia';
        });
    };

    // doRegister — registracia noveho uzivatela
    // AKO TO FUNGUJE:
    //   1. Zoberie username a password z registracnych input policok
    //   2. Posle POST na /api/auth.php?action=register s JSON { username, password }
    //   3. PHP skontroluje ci username neexistuje, hashne heslo cez bcrypt a ulozi do DB
    //   4. Ak OK → vrati { ok: true, user: {...} } → rovnako ako login
    //   5. Ak username existuje → vrati chybu
    CurlingGame.prototype.doRegister = function () {
        var self = this;
        var username = document.getElementById('reg-username').value.trim();
        var password = document.getElementById('reg-password').value;
        if (!username || !password) return;

        fetch(getApiBase() + '/auth.php?action=register', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
            if (res.ok && res.data.ok) {
                self.currentUser = res.data.user;
                self.onAuthSuccess();
            } else {
                document.getElementById('auth-error').textContent = res.data.error || 'Chyba';
            }
        })
        .catch(function () {
            document.getElementById('auth-error').textContent = 'Chyba pripojenia';
        });
    };

    // doGuest — vytvorenie guest uctu (hrac chce hrat bez registracie)
    // AKO TO FUNGUJE:
    //   1. Posle POST na /api/auth.php?action=guest (bez body — server vygeneruje meno)
    //   2. PHP vytvori novy riadok v tabulke users s nahodnym menom (napr. 'Guest_a3f2')
    //      a priznakom is_guest = 1
    //   3. Vrati { ok: true, user: { id, username: 'Guest_xxxx', is_guest: true } }
    //   4. Guest ucty maju rovnake funkcie ako normalne ucty (okrem statistik)
    CurlingGame.prototype.doGuest = function () {
        var self = this;
        fetch(getApiBase() + '/auth.php?action=guest', {
            method: 'POST',
            credentials: 'include'
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
            if (res.ok && res.data.ok) {
                self.currentUser = res.data.user;
                self.onAuthSuccess();
            } else {
                document.getElementById('auth-error').textContent = res.data.error || 'Chyba';
            }
        })
        .catch(function () {
            document.getElementById('auth-error').textContent = 'Chyba pripojenia';
        });
    };

    // doLogout — odhlasenie, navrat na auth obrazovku
    // AKO TO FUNGUJE:
    //   1. Posle POST na /api/auth.php?action=logout
    //   2. PHP znici session (session_destroy()) → cookie PHPSESSID sa stane neplatnym
    //   3. Vynulujeme this.currentUser → uz nemame prihlaseneho uzivatela
    //   4. Zastavime lobby chat polling (nepotrebujeme ak nie sme prihlaseni)
    //   5. Zobrazime auth obrazovku
    CurlingGame.prototype.doLogout = function () {
        var self = this;
        fetch(getApiBase() + '/auth.php?action=logout', {
            method: 'POST',
            credentials: 'include'
        }).then(function () {
            self.currentUser = null;
            self.stopLobbyChat();
            self.showScreen('auth');
        });
    };

    // onAuthSuccess — po uspesnom prihlaseni/registracii/guest
    // Vola sa po kazdom uspesnom auth (login, register, guest)
    // 1. Vymaze chybovu hlasku z auth formulara
    // 2. Zobrazi "Prihlaseny: Meno" v menu hlavicke
    // 3. Prepne na menu obrazovku
    // 4. Nacita leaderboard a spusti lobby chat
    CurlingGame.prototype.onAuthSuccess = function () {
        document.getElementById('auth-error').textContent = '';
        document.getElementById('user-display').textContent =
            this.t('loggedAs') + this.currentUser.username;
        this.showScreen('menu');
        this.fetchLeaderboard();
        this.startLobbyChat();
    };

    // =========================================================================
    // LEADERBOARD — nacitanie a zobrazenie rebricka
    // =========================================================================

    // fetchLeaderboard — stiahne top 5 hracov z PHP API
    // GET /api/leaderboard.php → vrati { total_games: N, top: [ { username, wins, win_rate }, ... ] }
    // Po nacitani zavola renderLeaderboard() ktora naplni HTML tabulky
    CurlingGame.prototype.fetchLeaderboard = function () {
        var self = this;
        fetch(getApiBase() + '/leaderboard.php', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                self.renderLeaderboard(data);
            })
            .catch(function () { /* tichy fail */ });
    };

    // renderLeaderboard — naplni HTML tabulky datami z API
    // 1. Zobrazi celkovy pocet hier (total_games) v hornom riadku
    // 2. Naplni tabulku top 5 hracov (menu aj in-game verziu)
    // 3. Nacita osobne statistiky prihlaseneho hraca (fetchMyStats)
    // 4. Ak je hrac admin → nacita admin panel (loadAdminPanel)
    CurlingGame.prototype.renderLeaderboard = function (data) {
        // Total games
        var totalEl = document.getElementById('lb-total-num');
        if (totalEl) totalEl.textContent = data.total_games || 0;

        // Top 5 table — menu
        this.fillLbTable('lb-tbody', data.top || []);

        // Top 5 table — in-game
        this.fillLbTable('game-lb-tbody', data.top || []);

        // My stats
        if (this.currentUser) {
            this.fetchMyStats();
        }

        // Admin panel
        this.loadAdminPanel();
    };

    // fillLbTable — naplni konkretnu HTML tabulku (tbody) radkami hracov
    // tbodyId: 'lb-tbody' (menu) alebo 'game-lb-tbody' (in-game)
    // top: pole { username, wins, win_rate } z API
    // Kazdy riadok: poradie | meno | vyhry | uspesnost(%)
    CurlingGame.prototype.fillLbTable = function (tbodyId, top) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';
        for (var i = 0; i < top.length; i++) {
            var r = top[i];
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + this.escapeHtml(r.username) + '</td><td>' + r.wins + '</td>' +
                (tbodyId === 'lb-tbody' ? '<td>' + r.win_rate + '%</td>' : '');
            tbody.appendChild(tr);
        }
        if (top.length === 0) {
            var tr2 = document.createElement('tr');
            tr2.innerHTML = '<td colspan="4" style="text-align:center;opacity:0.5">—</td>';
            tbody.appendChild(tr2);
        }
    };

    // fetchMyStats — nacitanie osobnych statistik prihlaseneho hraca
    // GET /api/leaderboard.php?action=player&id=X → { player: { games, wins, losses, draws, win_rate } }
    // Naplni #lb-my-stats HTML element s udajmi
    CurlingGame.prototype.fetchMyStats = function () {
        var self = this;
        if (!this.currentUser) return;
        fetch(getApiBase() + '/leaderboard.php?action=player&id=' + this.currentUser.id, { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.player) {
                    var p = data.player;
                    var el = document.getElementById('lb-my-stats');
                    if (el) {
                        el.innerHTML = '<strong>' + self.t('myStats') + '</strong><br>' +
                            self.t('gamesPlayed') + p.games + '<br>' +
                            self.t('winsLabel') + p.wins + '<br>' +
                            self.t('lossesLabel') + p.losses + '<br>' +
                            self.t('drawsLabel') + (p.draws || 0) + '<br>' +
                            self.t('winRate') + p.win_rate + '%';
                    }
                }
            })
            .catch(function () {});
    };

    // escapeHtml — prevencia pred XSS (Cross-Site Scripting)
    // Pouzivame DOM API: textContent automaticky escapuje HTML znaky (<, >, &, ", ')
    // Napr. '<script>alert(1)</script>' → '&lt;script&gt;alert(1)&lt;/script&gt;'
    // Takto sa uzivatelsky vstup (mena hracov) NIKDY nevykoná ako HTML/JS kod
    CurlingGame.prototype.escapeHtml = function (str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    // =========================================================================
    // ADMIN PANEL — editovanie statistik hracov (len pre admina)
    // =========================================================================

    // loadAdminPanel — nacitanie admin panelu pre editovanie statistik
    // AKO TO FUNGUJE:
    //   1. Ak uzivatel NIE JE admin → skryje panel a vrati sa
    //   2. Ak JE admin → GET /api/stats.php → vrati zoznam vsetkych userov + total_games
    //   3. Pre kazdeho usera vytvori riadok s input poliami (hry, vyhry, prehry, remizy)
    //   4. Admin moze zmenit hodnoty a kliknut OK → PUT /api/stats.php?action=update_user
    //   5. Moze tiez zmenit globalny pocet hier → PUT /api/stats.php?action=update_global
    CurlingGame.prototype.loadAdminPanel = function () {
        var panel = document.getElementById('admin-panel');
        if (!panel) return;

        if (!this.currentUser || !this.currentUser.is_admin) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';

        var self = this;
        fetch(getApiBase() + '/stats.php', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                // Total games
                var totalInput = document.getElementById('admin-total-games');
                if (totalInput) totalInput.value = data.total_games || 0;

                // Users list
                var container = document.getElementById('admin-users-list');
                if (!container) return;
                container.innerHTML = '';

                var users = data.users || [];
                for (var i = 0; i < users.length; i++) {
                    var u = users[i];
                    var row = document.createElement('div');
                    row.className = 'admin-user-row';
                    row.setAttribute('data-uid', u.id);
                    row.innerHTML =
                        '<div class="admin-user-name">' + self.escapeHtml(u.username) + (u.is_guest ? ' (G)' : '') + '</div>' +
                        '<div class="admin-user-fields">' +
                            '<label>H:<input type="number" class="admin-inp" data-field="games" value="' + (u.games || 0) + '" min="0"></label>' +
                            '<label>V:<input type="number" class="admin-inp" data-field="wins" value="' + (u.wins || 0) + '" min="0"></label>' +
                            '<label>P:<input type="number" class="admin-inp" data-field="losses" value="' + (u.losses || 0) + '" min="0"></label>' +
                            '<label>R:<input type="number" class="admin-inp" data-field="draws" value="' + (u.draws || 0) + '" min="0"></label>' +
                            '<button class="btn-admin-save-user btn-small" style="font-size:10px;padding:2px 6px;">OK</button>' +
                        '</div>';
                    container.appendChild(row);
                }

                // Delegovane klik handlery pre save buttony
                container.onclick = function (e) {
                    if (e.target.classList.contains('btn-admin-save-user')) {
                        var row = e.target.closest('.admin-user-row');
                        if (!row) return;
                        var uid = row.getAttribute('data-uid');
                        var inputs = row.querySelectorAll('.admin-inp');
                        var body = { user_id: parseInt(uid, 10) };
                        for (var j = 0; j < inputs.length; j++) {
                            body[inputs[j].getAttribute('data-field')] = parseInt(inputs[j].value, 10) || 0;
                        }
                        fetch(getApiBase() + '/stats.php?action=update_user', {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        }).then(function (r) { return r.json(); })
                          .then(function (res) {
                            if (res.ok) self.fetchLeaderboard();
                        });
                    }
                };
            })
            .catch(function () {});

        // Save total games
        var btnTotal = document.getElementById('btn-admin-save-total');
        if (btnTotal && !btnTotal._bound) {
            btnTotal._bound = true;
            btnTotal.addEventListener('click', function () {
                var val = parseInt(document.getElementById('admin-total-games').value, 10) || 0;
                fetch(getApiBase() + '/stats.php?action=update_global', {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ total_games: val })
                }).then(function (r) { return r.json(); })
                  .then(function (res) {
                    if (res.ok) self.fetchLeaderboard();
                });
            });
        }
    };

    // =========================================================================
    // LOBBY CHAT — polling sprav z PHP API
    // =========================================================================

    // startLobbyChat — spusti polling lobby chatu kazdych 3 sekundy
    // AKO TO FUNGUJE:
    //   1. Okamzite nacita spravy (fetchLobbyMessages)
    //   2. Nastavi interval ktory kazdych 3000ms (3 sekundy) znovu nacita spravy
    //   PRECO POLLING A NIE WEBSOCKET?
    //   Lobby chat je ulozeny v PHP/MySQL — pouzivame HTTP (fetch) nie WebSocket.
    //   WebSocket pouzivame len pre hernu logiku (real-time strielanie kamenov).
    //   Pre lobby chat je polling kazdych 3s dostatocne rychly a jednoduchsi.
    CurlingGame.prototype.startLobbyChat = function () {
        this.fetchLobbyMessages();
        var self = this;
        this.lobbyChatInterval = setInterval(function () {
            self.fetchLobbyMessages();
        }, 3000);
    };

    // stopLobbyChat — zastavi polling lobby chatu (ked hrac odide z menu)
    CurlingGame.prototype.stopLobbyChat = function () {
        if (this.lobbyChatInterval) {
            clearInterval(this.lobbyChatInterval);
            this.lobbyChatInterval = null;
        }
    };

    // fetchLobbyMessages — stiahne vsetky spravy lobby chatu z PHP API
    // GET /api/lobby.php → { messages: [ { username, message, created_at }, ... ] }
    CurlingGame.prototype.fetchLobbyMessages = function () {
        var self = this;
        fetch(getApiBase() + '/lobby.php', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                self.renderLobbyMessages(data.messages || []);
            })
            .catch(function () {});
    };

    // renderLobbyMessages — vykreslenie lobby sprav do HTML kontajnera
    // Vymaze stary obsah a nanovo vytvori DOM elementy pre kazdu spravu
    // container scrollne na koniec aby bola vidiet najnovsia sprava
    CurlingGame.prototype.renderLobbyMessages = function (messages) {
        var container = document.getElementById('lobby-chat-messages');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            var div = document.createElement('div');
            div.className = 'lobby-msg';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'lobby-msg-name';
            nameSpan.textContent = m.username + ':';

            var textSpan = document.createElement('span');
            textSpan.className = 'lobby-msg-text';
            textSpan.textContent = ' ' + m.message;

            div.appendChild(nameSpan);
            div.appendChild(textSpan);
            container.appendChild(div);
        }
        container.scrollTop = container.scrollHeight;
    };

    // sendLobbyChat — odoslanie lobby spravy na PHP API
    // AKO TO FUNGUJE:
    //   1. Zoberie text z inputu
    //   2. Admin moze pouzit prikaz /clear → DELETE /api/lobby.php (vymaze cely chat)
    //   3. Normalny hrac: 5-sekundovy cooldown (anti-spam)
    //   4. POST /api/lobby.php s JSON { message: text } → PHP ulozi do DB
    //   5. Po odoslani okamzite nacita spravy (fetchLobbyMessages) aby videl svoju spravu
    CurlingGame.prototype.sendLobbyChat = function () {
        var self = this;
        var input = document.getElementById('lobby-chat-input');
        var text = input.value.trim();
        if (!text) return;

        // Prikaz /clear — admin moze vymazat cely chat (bez cooldownu)
        if (text === '/clear' && this.currentUser && this.currentUser.is_admin) {
            input.value = '';
            fetch(getApiBase() + '/lobby.php', {
                method: 'DELETE',
                credentials: 'include'
            }).then(function () {
                self.fetchLobbyMessages();
            });
            return;
        }

        // 5-sekundovy cooldown
        if (this.lobbyChatCooldown) {
            this.notify(this.t('lobbyCooldown'));
            return;
        }

        input.value = '';
        this.lobbyChatCooldown = true;
        setTimeout(function () { self.lobbyChatCooldown = false; }, 5000);

        fetch(getApiBase() + '/lobby.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        }).then(function () {
            self.fetchLobbyMessages();
        });
    };

    // =========================================================================
    // PASSIVE WS — lahke spojenie len pre online pocitadlo na menu obrazovke
    // =========================================================================
    // Vytvorime oddelene WebSocket spojenie ktore len pocuva online_count spravy.
    // Toto je potrebne preto, ze hlavne WS (this.ws) sa vytvori az po kliknuti "Hrat".
    // Na menu obrazovke by sme inak nemali pocet pripojenych hracov.
    // Pri pripojeni do hry (connect) sa toto pasivne spojenie zatvori,
    // pretoze hlavne WS uz dostava online_count spravy.
    CurlingGame.prototype.connectStatusWs = function () {
        var self = this;
        try {
            var url = getWsUrl();
            this.statusWs = new WebSocket(url);
            this.statusWs.onmessage = function (event) {
                try {
                    var data = JSON.parse(event.data);
                    if (data.type === 'online_count') {
                        self.updateOnlineCount(data.count);
                    }
                    // Lobby status prichadza aj cez pasivne WS
                    // — zobrazujeme pocet cakajucich hracov na menu obrazovke
                    if (data.type === 'lobby_status') {
                        self.onLobbyStatus(data.lobbies);
                    }
                } catch (e) { /* ignoruj zle spravy */ }
            };
            this.statusWs.onclose = function () {
                self.statusWs = null;
                // Reconnect po 5 sekundach ak nie sme v hre
                // (ak sme v hre, hlavne WS uz pocuva online_count)
                if (!self.ws) {
                    setTimeout(function () {
                        if (!self.ws) self.connectStatusWs();
                    }, 5000);
                }
            };
            this.statusWs.onerror = function () {
                // Ticho ignorujeme — reconnect riesi onclose
            };
        } catch (e) { /* ignoruj chybu pripojenia */ }
    };

    // Zatvorenie pasivneho WS (pred pripojenim do hry)
    CurlingGame.prototype.disconnectStatusWs = function () {
        if (this.statusWs) {
            this.statusWs.onclose = null;
            this.statusWs.close();
            this.statusWs = null;
        }
    };

    // =========================================================================
    // Game loop
    // =========================================================================
    CurlingGame.prototype.startLoop = function () {
        var self = this;
        (function loop() {
            self.update();
            self.render();
            requestAnimationFrame(loop);
        })();
    };

    CurlingGame.prototype.update = function () {
        if (this.screen !== 'game') return;
        if (!this.engine) return;
        if (this.paused || this.gameOver) return;

        Engine.update(this.engine, 1000 / 60);
        this.checkStopped();
    };

    // =========================================================================
    // RENDERING — kreslenie hry na Canvas
    // =========================================================================
    // Render sa vola 60x za sekundu cez requestAnimationFrame.
    // Postup: vycistenie → pozadie → hracia plocha → ciel → kamene → navigacia
    // Pouzivame ctx.save()/restore() + translate/scale pre responsivitu
    CurlingGame.prototype.render = function () {
        if (this.screen !== 'game') return;
        if (!this.ctx || !this.config) return;

        // Prepocitaj scale/offset kazdy frame (pre pinch-to-zoom bez resize canvasu)
        this.resize(true);

        var ctx = this.ctx;
        var fw = this.config.field.width;
        var fh = this.config.field.height;

        ctx.fillStyle = this.theme === 'light' ? '#e8e8e8' : COLORS.bg;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        // Field
        ctx.fillStyle = COLORS.field;
        ctx.fillRect(0, 0, fw, fh);

        // Subtle field lines
        ctx.strokeStyle = COLORS.hogLine;
        ctx.lineWidth = 1;

        // Center line
        ctx.beginPath();
        ctx.moveTo(fw / 2, 0);
        ctx.lineTo(fw / 2, fh);
        ctx.stroke();

        // Hog lines
        ctx.beginPath();
        ctx.moveTo(0, fh * 0.35);
        ctx.lineTo(fw, fh * 0.35);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, fh * 0.85);
        ctx.lineTo(fw, fh * 0.85);
        ctx.stroke();

        // Target tee line
        var ty = this.config.target.y;
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(fw, ty);
        ctx.stroke();

        // Field border
        ctx.strokeStyle = COLORS.fieldStroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, fw, fh);

        this.drawTarget(ctx);
        this.drawStones(ctx);

        if (this.showPhantom && !this.shotSent) {
            this.drawPhantomStone(ctx);
        }

        if (this.isAiming && this.aimCurrent) {
            this.drawAimLine(ctx);
        }

        ctx.restore();

        this.updateHUD();
    };

    // Kreslenie ciela — sustredne kruhy (ring1=cervena, ring2=biela, ring3=modra)
    CurlingGame.prototype.drawTarget = function (ctx) {
        var t = this.config.target;

        // Ring 1 - outer
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.targetRing1;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ring 2
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * 0.66, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.targetRing2;
        ctx.fill();
        ctx.stroke();

        // Ring 3
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * 0.33, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.targetRing3;
        ctx.fill();
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.targetCenter;
        ctx.fill();

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(t.x - t.radius - 5, t.y);
        ctx.lineTo(t.x + t.radius + 5, t.y);
        ctx.moveTo(t.x, t.y - t.radius - 5);
        ctx.lineTo(t.x, t.y + t.radius + 5);
        ctx.strokeStyle = COLORS.crosshair;
        ctx.lineWidth = 1;
        ctx.stroke();
    };

    // Kreslenie kamenov — kruh s tienom, odleskom a cislom
    // Cervene = hrac 1, modre = hrac 2
    CurlingGame.prototype.drawStones = function (ctx) {
        // Pouzivame circleRadius z fyzikalneho telesa — po Matter.Body.scale() sa automaticky aktualizuje.
        // To umoznuje ze kamen strielany po /cheats sa vizualne aj fyzikalne zhoduje so skutocnou velkostou.
        for (var i = 0; i < this.stones.length; i++) {
            var stone = this.stones[i];
            var pos = stone.body.position;
            var sr = stone.body.circleRadius || this.config.stoneRadius;  // Fallback pre istotu
            var color = stone.player === 1 ? COLORS.player1 : COLORS.player2;

            // Shadow
            ctx.beginPath();
            ctx.arc(pos.x + 2, pos.y + 2, sr, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fill();

            // Body
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, sr, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = COLORS.stoneStroke;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Highlight
            ctx.beginPath();
            ctx.arc(pos.x - sr * 0.25, pos.y - sr * 0.25, sr * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fill();

            // Stone number label
            ctx.fillStyle = COLORS.white;
            ctx.font = 'bold ' + Math.round(sr * 0.8) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(stone.num || '', pos.x, pos.y + 1);
        }
    };

    // Kreslenie fantomoveho kamena — pulzujuci kruh na startovej pozicii
    // Ukazuje hracovi kde kliknut pre vystrel
    CurlingGame.prototype.drawPhantomStone = function (ctx) {
        var start = this.getStartPosition();
        var sr = this.config.stoneRadius;
        var color = this.playerNumber === 1 ? COLORS.player1 : COLORS.player2;

        var pulse = Math.sin(Date.now() / 300) * 0.12 + 0.8;

        ctx.save();
        ctx.globalAlpha = pulse;

        ctx.beginPath();
        ctx.arc(start.x, start.y, sr, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = COLORS.stoneStroke;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();

        // "Click here" ring
        var ringPulse = Math.sin(Date.now() / 500) * 4 + sr + 8;
        ctx.beginPath();
        ctx.arc(start.x, start.y, ringPulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
    };

    // Kreslenie mierenia — ciara od kamena ku kurzoru + percento sily
    // V "easy" mode sa zobrazi aj biela sipka ukazujuca smer vystrelu
    // V "hard" mode je len ciara a percento (hrac musi odhadnut smer)
    CurlingGame.prototype.drawAimLine = function (ctx) {
        var start = this.getStartPosition();
        var dx = this.aimCurrent.x - start.x;
        var dy = this.aimCurrent.y - start.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var force = Math.min(dist / MAX_DRAG, 1.0);

        // Drag line (from stone to cursor) — always visible
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(this.aimCurrent.x, this.aimCurrent.y);
        ctx.strokeStyle = COLORS.aimLine;
        ctx.lineWidth = 1.5 + force * 2.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Force percentage — always visible
        ctx.fillStyle = COLORS.white;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(force * 100) + '%', start.x, start.y + this.config.stoneRadius + 22);

        // Shot direction arrow — only in easy mode
        if (this.difficulty === 'easy') {
            var arrowLen = 25 + force * 50;
            var angle = Math.atan2(-dy, -dx);
            var endX = start.x + Math.cos(angle) * arrowLen;
            var endY = start.y + Math.sin(angle) * arrowLen;

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = COLORS.white;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Arrowhead
            var hl = 10;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
                endX - Math.cos(angle - 0.45) * hl,
                endY - Math.sin(angle - 0.45) * hl
            );
            ctx.moveTo(endX, endY);
            ctx.lineTo(
                endX - Math.cos(angle + 0.45) * hl,
                endY - Math.sin(angle + 0.45) * hl
            );
            ctx.stroke();
        }
    };

    // =========================================================================
    // INICIALIZACIA — spustenie hry po nacitani stranky
    // =========================================================================
    // Po nacitani DOM sa vytvori instancia CurlingGame ktora:
    //   1. Nastavi vsetky UI listenery (setupUI)
    //   2. Spusti hlavnu slucku (startLoop → requestAnimationFrame)
    //   3. Caka na akciu hraca (kliknutie "Hrat")
    document.addEventListener('DOMContentLoaded', function () {
        window.game = new CurlingGame();
    });

})();
