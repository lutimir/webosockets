-- ==========================================================================
-- CURLING ONLINE — SQL DUMP PRE SERVER (phpMyAdmin)
-- ==========================================================================
-- Databaza: curling_db
-- Server: node69.webte.fei.stuba.sk
-- User: xlutisan
--
-- INSTRUKCIE:
--   1. Otvor phpMyAdmin na serveri
--   2. Vyber databazu 'curling_db' (ak neexistuje, vytvor ju s UTF-8)
--   3. Klikni na zalozku 'SQL'
--   4. Vloz tento cely obsah a klikni 'Go'
-- ==========================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- --------------------------------------------------------------------------
-- TABULKA: users — registrovani hraci + guest ucty + admin
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    is_guest    TINYINT(1)   NOT NULL DEFAULT 0,
    is_admin    TINYINT(1)   NOT NULL DEFAULT 0,
    games       INT          NOT NULL DEFAULT 0,
    wins        INT          NOT NULL DEFAULT 0,
    losses      INT          NOT NULL DEFAULT 0,
    draws       INT          NOT NULL DEFAULT 0,
    session_token VARCHAR(64) DEFAULT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------------------------
-- TABULKA: lobby_messages — spravy z lobby chatu
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lobby_messages (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL,
    message     VARCHAR(500) NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------------------------
-- TABULKA: global_stats — globalne statistiky (1 riadok)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_stats (
    id              INT PRIMARY KEY DEFAULT 1,
    total_games     INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Inicializacia globalnych statistik
INSERT IGNORE INTO global_stats (id, total_games) VALUES (1, 0);

-- --------------------------------------------------------------------------
-- ADMIN UCET — NEVKLADAME TU! config.php runMigrations() ho vytvori
-- automaticky s korektnym bcrypt hashom pri prvom PHP requeste.
-- Ak admin uz existuje, runMigrations() opravi heslo ak je nespravne.
-- Predvolene: meno=admin, heslo=admin
-- --------------------------------------------------------------------------

-- ==========================================================================
-- HOTOVO! Tabulky users, lobby_messages a global_stats su vytvorene.
-- Admin ucet sa vytvori automaticky pri prvom nacitani stranky (config.php).
-- ==========================================================================
