<?php
// ==========================================================================
// api/auth.php — Registrácia, Login, Guest, Session check, Logout
// ==========================================================================
// Endpointy:
//   POST /api/auth.php?action=register  { username, password }
//   POST /api/auth.php?action=login     { username, password }
//   POST /api/auth.php?action=guest     (vygeneruje Guest_XXX)
//   GET  /api/auth.php?action=me        (vráti aktuálneho usera)
//   POST /api/auth.php?action=logout
// ==========================================================================
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$pdo = getDB();
if (!$pdo) exit;

switch ($action) {
    case 'register':
        handleRegister($pdo);
        break;
    case 'login':
        handleLogin($pdo);
        break;
    case 'guest':
        handleGuest($pdo);
        break;
    case 'me':
        handleMe($pdo);
        break;
    case 'logout':
        handleLogout($pdo);
        break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Neznáma akcia']);
}

// ==========================================================================
// REGISTER — jednoduché: meno + heslo, žiadny email, žiadny regex
// ==========================================================================
function handleRegister(PDO $pdo): void {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if ($username === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Meno a heslo sú povinné']);
        return;
    }
    if (mb_strlen($username) > 50) {
        http_response_code(400);
        echo json_encode(['error' => 'Meno je príliš dlhé (max 50 znakov)']);
        return;
    }
    if (strtolower($username) === 'admin') {
        http_response_code(400);
        echo json_encode(['error' => 'Toto meno je rezervované']);
        return;
    }
    // Prefix Guest_ je rezervovaný pre guest účty
    if (stripos($username, 'guest_') === 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Meno nesmie začínať na "Guest_"']);
        return;
    }

    // Kontrola unikátnosti
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        http_response_code(409);
        echo json_encode(['error' => 'Meno je už obsadené']);
        return;
    }

    // Vytvorenie účtu — bcrypt hash
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    $stmt->execute([$username, $hash]);
    $userId = $pdo->lastInsertId();

    // Generovanie session tokenu
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare("UPDATE users SET session_token = ? WHERE id = ?");
    $stmt->execute([$token, $userId]);

    // Automatické prihlásenie po registrácii
    $_SESSION['user_id'] = (int)$userId;
    $_SESSION['username'] = $username;
    $_SESSION['is_admin'] = false;
    $_SESSION['is_guest'] = false;
    $_SESSION['session_token'] = $token;

    echo json_encode(['ok' => true, 'user' => [
        'id' => (int)$userId,
        'username' => $username,
        'is_guest' => false,
        'is_admin' => false
    ]]);
}

// ==========================================================================
// LOGIN — kontrola hesla cez password_verify (bcrypt)
// ==========================================================================
function handleLogin(PDO $pdo): void {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if ($username === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Meno a heslo sú povinné']);
        return;
    }

    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Nesprávne meno alebo heslo']);
        return;
    }

    // Generovanie session tokenu — zabezpecuje ze len 1 session na usera
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare("UPDATE users SET session_token = ? WHERE id = ?");
    $stmt->execute([$token, $user['id']]);

    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['is_admin'] = (bool)$user['is_admin'];
    $_SESSION['is_guest'] = (bool)$user['is_guest'];
    $_SESSION['session_token'] = $token;

    echo json_encode(['ok' => true, 'user' => [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'is_guest' => (bool)$user['is_guest'],
        'is_admin' => (bool)$user['is_admin']
    ]]);
}

// ==========================================================================
// GUEST — vygeneruje Guest_XXX (náhodné číslo 0-999), max 1000 guestov
// ==========================================================================
function handleGuest(PDO $pdo): void {
    // Počet existujúcich guestov
    $stmt = $pdo->query("SELECT COUNT(*) as cnt FROM users WHERE is_guest = 1");
    $count = (int)$stmt->fetch()['cnt'];
    if ($count >= 1000) {
        http_response_code(429);
        echo json_encode(['error' => 'Maximálny počet guest účtov (1000) dosiahnutý']);
        return;
    }

    // Generuj unikátne Guest_XXX
    $maxAttempts = 50;
    $guestName = null;
    for ($i = 0; $i < $maxAttempts; $i++) {
        $num = random_int(0, 999);
        $name = 'Guest_' . str_pad($num, 3, '0', STR_PAD_LEFT);
        $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
        $stmt->execute([$name]);
        if (!$stmt->fetch()) {
            $guestName = $name;
            break;
        }
    }
    if (!$guestName) {
        // Skús sequenciálne
        for ($num = 0; $num <= 999; $num++) {
            $name = 'Guest_' . str_pad($num, 3, '0', STR_PAD_LEFT);
            $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
            $stmt->execute([$name]);
            if (!$stmt->fetch()) {
                $guestName = $name;
                break;
            }
        }
    }
    if (!$guestName) {
        http_response_code(429);
        echo json_encode(['error' => 'Nepodarilo sa vytvoriť guest účet']);
        return;
    }

    // Guest nemá heslo (random hash aby sa nedal prihlásiť klasicky)
    $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("INSERT INTO users (username, password, is_guest) VALUES (?, ?, 1)");
    $stmt->execute([$guestName, $hash]);
    $userId = $pdo->lastInsertId();

    // Generovanie session tokenu
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare("UPDATE users SET session_token = ? WHERE id = ?");
    $stmt->execute([$token, $userId]);

    $_SESSION['user_id'] = (int)$userId;
    $_SESSION['username'] = $guestName;
    $_SESSION['is_admin'] = false;
    $_SESSION['is_guest'] = true;
    $_SESSION['session_token'] = $token;

    echo json_encode(['ok' => true, 'user' => [
        'id' => (int)$userId,
        'username' => $guestName,
        'is_guest' => true,
        'is_admin' => false
    ]]);
}

// ==========================================================================
// ME — vráti aktuálne prihláseného usera + jeho štatistiky
// ==========================================================================
function handleMe(PDO $pdo): void {
    if (empty($_SESSION['user_id'])) {
        echo json_encode(['user' => null]);
        return;
    }

    $stmt = $pdo->prepare("SELECT id, username, is_guest, is_admin, games, wins, losses, draws, session_token FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    if (!$user) {
        unset($_SESSION['user_id']);
        echo json_encode(['user' => null]);
        return;
    }

    // Kontrola session tokenu — ak sa nezhoduje, niekto iny sa prihlasil s tymto uctom
    if (isset($user['session_token']) && isset($_SESSION['session_token'])) {
        if ($user['session_token'] !== $_SESSION['session_token']) {
            session_destroy();
            echo json_encode(['user' => null, 'kicked' => true, 'error' => 'Prihlásený z iného zariadenia']);
            return;
        }
    }

    unset($user['session_token']);
    $user['win_rate'] = $user['games'] > 0 ? round(($user['wins'] / $user['games']) * 100, 1) : 0;

    echo json_encode(['user' => $user]);
}

// ==========================================================================
// LOGOUT — zruší session
// ==========================================================================
function handleLogout(PDO $pdo): void {
    // Vycistime session token v DB
    if (!empty($_SESSION['user_id'])) {
        $stmt = $pdo->prepare("UPDATE users SET session_token = NULL WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
    }
    session_destroy();
    echo json_encode(['ok' => true]);
}
