<?php
// ==========================================================================
// config.php — Konfigurácia databázy a session pre Curling Online
// ==========================================================================
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Session
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// ==========================================================================
// DATABÁZA — pripojenie cez PDO
// ==========================================================================
// Auto-detekcia: ak sme na VPS (zadanie3 prefix) → VPS DB, inak → Docker DB
if (str_starts_with($_SERVER['SCRIPT_NAME'] ?? '/', '/zadanie3/')) {
    $db_host = "";
    $db_name = "";
    $db_user = "";
    $db_pass = "";
} else {
    $db_host = "db";           // Docker kontajner MariaDB
    $db_name = "app_db";       // MYSQL_DATABASE z docker-compose.yml
    $db_user = "app_user";     // MYSQL_USER
    $db_pass = "app_pass";     // MYSQL_PASSWORD
}

function getDB(): ?PDO {
    global $db_host, $db_name, $db_user, $db_pass;
    static $pdo = null;
    if ($pdo) return $pdo;

    try {
        $pdo = new PDO(
            "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
            $db_user,
            $db_pass
        );
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        runMigrations($pdo);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'DB chyba: ' . $e->getMessage()]);
        return null;
    }
}

// ==========================================================================
// MIGRÁCIE — vytvorenie tabuliek ak neexistujú
// ==========================================================================
function runMigrations(PDO $pdo): void {
    $pdo->exec("
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
            created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lobby_messages (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            username    VARCHAR(50)  NOT NULL,
            message     VARCHAR(500) NOT NULL,
            created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS global_stats (
            id              INT PRIMARY KEY DEFAULT 1,
            total_games     INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pdo->exec("INSERT IGNORE INTO global_stats (id, total_games) VALUES (1, 0)");

    // Pridanie session_token stlpca ak neexistuje (pre single-session enforcement)
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN session_token VARCHAR(64) DEFAULT NULL");
    } catch (PDOException $e) {
        // Stlpec uz existuje — ignorujeme
    }

    // Vytvorenie alebo oprava admin účtu (heslo: admin)
    $stmt = $pdo->prepare("SELECT id, password FROM users WHERE username = 'admin'");
    $stmt->execute();
    $admin = $stmt->fetch();
    if (!$admin) {
        // Admin neexistuje — vytvorime ho
        $hash = password_hash('admin', PASSWORD_BCRYPT);
        $stmt = $pdo->prepare("INSERT INTO users (username, password, is_admin) VALUES ('admin', ?, 1)");
        $stmt->execute([$hash]);
    } elseif (!password_verify('admin', $admin['password'])) {
        // Admin existuje ale heslo nesedi — opravime hash
        $hash = password_hash('admin', PASSWORD_BCRYPT);
        $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
        $stmt->execute([$hash, $admin['id']]);
    }
}
