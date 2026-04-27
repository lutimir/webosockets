<?php
// ==========================================================================
// api/lobby.php — Lobby chat správy (GET = načítanie, POST = nová správa, DELETE = /clear)
// ==========================================================================
// Endpointy:
//   GET    /api/lobby.php              — posledných 50 správ
//   POST   /api/lobby.php              { message }
//   DELETE  /api/lobby.php             — vymaže všetky správy (len admin)
// ==========================================================================
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');

$pdo = getDB();
if (!$pdo) exit;

$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        handleGetMessages($pdo);
        break;
    case 'POST':
        handlePostMessage($pdo);
        break;
    case 'DELETE':
        handleClearMessages($pdo);
        break;
    default:
        http_response_code(405);
        echo json_encode(['error' => 'Nepovolená metóda']);
}

// ==========================================================================
// GET — posledných 50 lobby správ
// ==========================================================================
function handleGetMessages(PDO $pdo): void {
    $stmt = $pdo->query("
        SELECT username, message, created_at
        FROM lobby_messages
        ORDER BY id DESC
        LIMIT 50
    ");
    $messages = array_reverse($stmt->fetchAll());
    echo json_encode(['messages' => $messages]);
}

// ==========================================================================
// POST — pridanie novej správy (musí byť prihlásený)
// ==========================================================================
function handlePostMessage(PDO $pdo): void {
    if (empty($_SESSION['username'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Neprihlásený']);
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $message = trim($input['message'] ?? '');

    if ($message === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Správa je prázdna']);
        return;
    }
    if (mb_strlen($message) > 500) {
        http_response_code(400);
        echo json_encode(['error' => 'Správa je príliš dlhá (max 500 znakov)']);
        return;
    }

    $stmt = $pdo->prepare("INSERT INTO lobby_messages (username, message) VALUES (?, ?)");
    $stmt->execute([$_SESSION['username'], $message]);

    echo json_encode(['ok' => true, 'msg' => [
        'username' => $_SESSION['username'],
        'message' => $message,
        'created_at' => date('Y-m-d H:i:s')
    ]]);
}

// ==========================================================================
// DELETE — vymazanie všetkých správ (len admin alebo /clear príkaz)
// ==========================================================================
function handleClearMessages(PDO $pdo): void {
    if (empty($_SESSION['is_admin']) || !$_SESSION['is_admin']) {
        http_response_code(403);
        echo json_encode(['error' => 'Len admin môže vymazať chat']);
        return;
    }

    $pdo->exec("DELETE FROM lobby_messages");
    echo json_encode(['ok' => true, 'cleared' => true]);
}
