<?php
// ==========================================================================
// api/leaderboard.php — Top 5 hráčov, globálne štatistiky, štatistiky hráča
// ==========================================================================
// Endpointy:
//   GET /api/leaderboard.php                      — top 5 + celkový počet hier
//   GET /api/leaderboard.php?action=player&id=X   — štatistiky konkrétneho hráča
// ==========================================================================
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');

$pdo = getDB();
if (!$pdo) exit;

$action = $_GET['action'] ?? 'top';

switch ($action) {
    case 'top':
        handleTop($pdo);
        break;
    case 'player':
        handlePlayer($pdo);
        break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Neznáma akcia']);
}

// ==========================================================================
// TOP 5 — najlepší hráči podľa výhier, + celkový počet odohratých hier
// ==========================================================================
function handleTop(PDO $pdo): void {
    // Top 5 hráčov podľa výhier (potom podľa win rate)
    $stmt = $pdo->query("
        SELECT username, games, wins, losses, draws,
               CASE WHEN games > 0 THEN ROUND((wins / games) * 100, 1) ELSE 0 END as win_rate
        FROM users
        WHERE is_admin = 0 AND games > 0
        ORDER BY wins DESC, win_rate DESC, games ASC
        LIMIT 5
    ");
    $top = $stmt->fetchAll();

    // Celkový počet odohratých hier
    $stmt2 = $pdo->query("SELECT total_games FROM global_stats WHERE id = 1");
    $row = $stmt2->fetch();
    $totalGames = $row ? (int)$row['total_games'] : 0;

    echo json_encode([
        'top' => $top,
        'total_games' => $totalGames
    ]);
}

// ==========================================================================
// PLAYER — štatistiky konkrétneho hráča
// ==========================================================================
function handlePlayer(PDO $pdo): void {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Chýba ID hráča']);
        return;
    }

    $stmt = $pdo->prepare("
        SELECT username, games, wins, losses, draws,
               CASE WHEN games > 0 THEN ROUND((wins / games) * 100, 1) ELSE 0 END as win_rate
        FROM users WHERE id = ?
    ");
    $stmt->execute([$id]);
    $player = $stmt->fetch();

    if (!$player) {
        http_response_code(404);
        echo json_encode(['error' => 'Hráč neexistuje']);
        return;
    }

    echo json_encode(['player' => $player]);
}
