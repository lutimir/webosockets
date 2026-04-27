<?php
// ==========================================================================
// api/stats.php — Admin REST API na editovanie štatistík
// ==========================================================================
// Endpointy (len pre admin):
//   GET    /api/stats.php                           — zoznam všetkých hráčov so štatistikami
//   PUT    /api/stats.php?action=update_user         { user_id, games?, wins?, losses?, draws? }
//   PUT    /api/stats.php?action=update_global        { total_games }
//   POST   /api/stats.php?action=record_game          { winner_id, loser_id, is_draw }
// ==========================================================================
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');

$pdo = getDB();
if (!$pdo) exit;

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// record_game je interné — volá ho server.js, nemusí byť admin (kontrola cez secret header)
if ($action === 'record_game' && $method === 'POST') {
    handleRecordGame($pdo);
    exit;
}

// Všetko ostatné vyžaduje admin oprávnenia
if ($method !== 'GET') {
    if (empty($_SESSION['is_admin']) || !$_SESSION['is_admin']) {
        http_response_code(403);
        echo json_encode(['error' => 'Len admin má prístup']);
        exit;
    }
}

switch ($action) {
    case '':
        handleListUsers($pdo);
        break;
    case 'update_user':
        handleUpdateUser($pdo);
        break;
    case 'update_global':
        handleUpdateGlobal($pdo);
        break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Neznáma akcia']);
}

// ==========================================================================
// GET — zoznam všetkých hráčov (admin panel)
// ==========================================================================
function handleListUsers(PDO $pdo): void {
    $stmt = $pdo->query("
        SELECT id, username, is_guest, is_admin, games, wins, losses, draws,
               CASE WHEN games > 0 THEN ROUND((wins / games) * 100, 1) ELSE 0 END as win_rate,
               created_at
        FROM users
        ORDER BY wins DESC, games DESC
    ");
    $users = $stmt->fetchAll();

    $stmt2 = $pdo->query("SELECT total_games FROM global_stats WHERE id = 1");
    $row = $stmt2->fetch();
    $totalGames = $row ? (int)$row['total_games'] : 0;

    echo json_encode(['users' => $users, 'total_games' => $totalGames]);
}

// ==========================================================================
// UPDATE_USER — admin prepíše štatistiky konkrétneho hráča
// Win rate sa počíta automaticky z wins/games
// ==========================================================================
function handleUpdateUser(PDO $pdo): void {
    $input = json_decode(file_get_contents('php://input'), true);
    $userId = (int)($input['user_id'] ?? 0);
    if ($userId <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Chýba user_id']);
        return;
    }

    // Načítaj aktuálne hodnoty
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        http_response_code(404);
        echo json_encode(['error' => 'Hráč neexistuje']);
        return;
    }

    // Aktualizuj len tie polia, ktoré prišli
    $games  = isset($input['games'])  ? (int)$input['games']  : (int)$user['games'];
    $wins   = isset($input['wins'])   ? (int)$input['wins']   : (int)$user['wins'];
    $losses = isset($input['losses']) ? (int)$input['losses'] : (int)$user['losses'];
    $draws  = isset($input['draws'])  ? (int)$input['draws']  : (int)$user['draws'];

    $stmt = $pdo->prepare("UPDATE users SET games = ?, wins = ?, losses = ?, draws = ? WHERE id = ?");
    $stmt->execute([$games, $wins, $losses, $draws, $userId]);

    $winRate = $games > 0 ? round(($wins / $games) * 100, 1) : 0;

    echo json_encode(['ok' => true, 'user' => [
        'id' => $userId,
        'username' => $user['username'],
        'games' => $games,
        'wins' => $wins,
        'losses' => $losses,
        'draws' => $draws,
        'win_rate' => $winRate
    ]]);
}

// ==========================================================================
// UPDATE_GLOBAL — admin prepíše celkový počet odohratých hier
// ==========================================================================
function handleUpdateGlobal(PDO $pdo): void {
    $input = json_decode(file_get_contents('php://input'), true);
    $totalGames = (int)($input['total_games'] ?? 0);

    $stmt = $pdo->prepare("UPDATE global_stats SET total_games = ? WHERE id = 1");
    $stmt->execute([$totalGames]);

    echo json_encode(['ok' => true, 'total_games' => $totalGames]);
}

// ==========================================================================
// RECORD_GAME — interný endpoint, volá ho server.js po skončení hry
// Aktualizuje štatistiky oboch hráčov + globálny počet hier
// ==========================================================================
function handleRecordGame(PDO $pdo): void {
    $input = json_decode(file_get_contents('php://input'), true);

    $winnerId = (int)($input['winner_id'] ?? 0);
    $loserId  = (int)($input['loser_id'] ?? 0);
    $isDraw   = (bool)($input['is_draw'] ?? false);

    if ($winnerId <= 0 || $loserId <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Chýba winner_id alebo loser_id']);
        return;
    }

    if ($isDraw) {
        // Remíza — obaja +1 games, +1 draws
        $stmt = $pdo->prepare("UPDATE users SET games = games + 1, draws = draws + 1 WHERE id = ?");
        $stmt->execute([$winnerId]);
        $stmt->execute([$loserId]);
    } else {
        // Víťaz
        $stmt = $pdo->prepare("UPDATE users SET games = games + 1, wins = wins + 1 WHERE id = ?");
        $stmt->execute([$winnerId]);
        // Porazený
        $stmt = $pdo->prepare("UPDATE users SET games = games + 1, losses = losses + 1 WHERE id = ?");
        $stmt->execute([$loserId]);
    }

    // Globálne počítadlo hier +1
    $pdo->exec("UPDATE global_stats SET total_games = total_games + 1 WHERE id = 1");

    echo json_encode(['ok' => true]);
}
