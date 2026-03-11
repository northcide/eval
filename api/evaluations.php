<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {

    case 'submit':
        $coach = requireLogin();
        $data  = getInput();

        $sessionId  = (int)($data['session_id'] ?? 0);
        $playerId   = (int)($data['player_id'] ?? 0);
        $skillIndex = (int)($data['skill_index'] ?? -1);
        $score      = (int)($data['score'] ?? 0);

        if (!$sessionId || !$playerId || $skillIndex < 0 || $score < 1 || $score > 10) {
            jsonResponse(['error' => 'Invalid data'], 400);
        }

        $db = getDB();
        // Look up skill name from the league's skills table
        $skillStmt = $db->prepare("
            SELECT sk.name FROM skills sk
            JOIN eval_sessions s ON s.league_id = sk.league_id
            WHERE s.id = ? ORDER BY sk.sort_order, sk.id
        ");
        $skillStmt->execute([$sessionId]);
        $skillNames = array_column($skillStmt->fetchAll(), 'name');
        $skillName  = $skillNames[$skillIndex] ?? 'Unknown';
        // INSERT OR UPDATE (on duplicate key = already scored)
        $stmt = $db->prepare("
            INSERT INTO evaluations (session_id, player_id, coach_id, skill_index, skill_name, score)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE score = VALUES(score)
        ");
        $stmt->execute([$sessionId, $playerId, $coach['id'], $skillIndex, $skillName, $score]);
        jsonResponse(['success' => true]);
        break;

    case 'my_all_scores':
        // All scores for this coach in this session (for review/edit UI)
        $coach = requireLogin();
        $db    = getDB();
        $sessionId = (int)($_GET['session_id'] ?? 0);
        $stmt = $db->prepare("SELECT skill_index, player_id, score FROM evaluations WHERE session_id=? AND coach_id=?");
        $stmt->execute([$sessionId, $coach['id']]);
        jsonResponse($stmt->fetchAll());
        break;

    case 'my_skill_scores':
        // Returns all player IDs a coach has scored for a given skill in a session
        $coach = requireLogin();
        $db    = getDB();
        $sessionId  = (int)($_GET['session_id'] ?? 0);
        $skillIndex = (int)($_GET['skill_index'] ?? -1);
        $stmt = $db->prepare("SELECT player_id FROM evaluations WHERE session_id=? AND coach_id=? AND skill_index=?");
        $stmt->execute([$sessionId, $coach['id'], $skillIndex]);
        $playerIds = array_column($stmt->fetchAll(), 'player_id');
        jsonResponse(['player_ids' => $playerIds]);
        break;

    case 'my_scores':
        // Coach checks if they already scored current player+skill
        $coach = requireLogin();
        $db    = getDB();

        $sessionId  = (int)($_GET['session_id'] ?? 0);
        $playerId   = (int)($_GET['player_id'] ?? 0);
        $skillIndex = (int)($_GET['skill_index'] ?? -1);

        $stmt = $db->prepare("SELECT score FROM evaluations WHERE session_id=? AND player_id=? AND coach_id=? AND skill_index=?");
        $stmt->execute([$sessionId, $playerId, $coach['id'], $skillIndex]);
        $row = $stmt->fetch();
        jsonResponse(['scored' => (bool)$row, 'score' => $row ? (int)$row['score'] : null]);
        break;

    case 'results':
        $coach    = requireLogin();
        $leagueId = getEffectiveLeagueId($coach);
        $db       = getDB();

        $isAdmin    = (bool)$coach['is_admin'];
        $divisionId = isset($_GET['division_id']) ? (int)$_GET['division_id'] : null;

        $where  = ['1=1'];
        $params = [];

        if (!$isAdmin) {
            $where[]  = 'e.coach_id = ?';
            $params[] = (int)$coach['id'];
        }

        if ($divisionId) {
            $where[]  = 'p.division_id = ?';
            $params[] = $divisionId;
        }

        if ($leagueId !== null) {
            $where[]  = 'd.league_id = ?';
            $params[] = $leagueId;
        }

        $whereStr = implode(' AND ', $where);

        $stmt = $db->prepare("
            SELECT
                p.id as player_id,
                p.name as player_name,
                p.age,
                CASE WHEN p.is_pitcher=1 AND p.is_catcher=1 THEN 'Pitcher/Catcher'
                     WHEN p.is_pitcher=1 THEN 'Pitcher'
                     WHEN p.is_catcher=1 THEN 'Catcher'
                     ELSE 'Player' END as position,
                p.division_id,
                d.name as division_name,
                e.skill_index,
                e.skill_name,
                AVG(e.score) as avg_score,
                COUNT(e.id) as eval_count
            FROM evaluations e
            JOIN players p ON p.id = e.player_id
            JOIN divisions d ON d.id = p.division_id
            WHERE $whereStr
            GROUP BY p.id, p.name, p.age, p.is_pitcher, p.is_catcher, p.division_id, d.name, e.skill_index, e.skill_name
            ORDER BY p.name, e.skill_index
        ");
        $stmt->execute($params);
        jsonResponse($stmt->fetchAll());
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
