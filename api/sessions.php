<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {

    case 'active':
        $coach = requireLogin();
        $db    = getDB();
        if ($coach['league_id'] !== null) {
            $stmt = $db->prepare("SELECT s.*, d.name as division_name FROM eval_sessions s JOIN divisions d ON d.id=s.division_id WHERE s.active=1 AND s.league_id=? ORDER BY s.id DESC LIMIT 1");
            $stmt->execute([$coach['league_id']]);
        } else {
            // Superadmin: all active sessions
            $stmt = $db->query("SELECT s.*, d.name as division_name FROM eval_sessions s JOIN divisions d ON d.id=s.division_id WHERE s.active=1 ORDER BY s.id DESC LIMIT 1");
        }
        $session = $stmt->fetch();
        jsonResponse($session ?: null);
        break;

    case 'start':
        $coach = requireAdmin();
        if ($coach['league_id'] === null) jsonResponse(['error' => 'Superadmin cannot start sessions directly'], 400);
        $data  = getInput();
        $divId = (int)($data['division_id'] ?? 0);
        if (!$divId) jsonResponse(['error' => 'division_id required'], 400);

        $db = getDB();
        // Verify division belongs to this league
        $stmt = $db->prepare("SELECT league_id FROM divisions WHERE id = ?");
        $stmt->execute([$divId]);
        $div = $stmt->fetch();
        if (!$div || $div['league_id'] != $coach['league_id']) jsonResponse(['error' => 'Division not in your league'], 403);

        // End any existing active sessions for this league
        $db->prepare("UPDATE eval_sessions SET active=0, ended_at=NOW() WHERE active=1 AND league_id=?")->execute([$coach['league_id']]);

        $stmt = $db->prepare("INSERT INTO eval_sessions (division_id, league_id, current_skill_index, current_player_index, active) VALUES (?,?,0,0,1)");
        $stmt->execute([$divId, $coach['league_id']]);
        $id = $db->lastInsertId();

        $row = $db->prepare("SELECT s.*, d.name as division_name FROM eval_sessions s JOIN divisions d ON d.id=s.division_id WHERE s.id=?");
        $row->execute([$id]);
        jsonResponse($row->fetch());
        break;

    case 'end':
        $coach = requireAdmin();
        $db = getDB();
        if ($coach['league_id'] !== null) {
            $db->prepare("UPDATE eval_sessions SET active=0, ended_at=NOW() WHERE active=1 AND league_id=?")->execute([$coach['league_id']]);
        } else {
            $db->exec("UPDATE eval_sessions SET active=0, ended_at=NOW() WHERE active=1");
        }
        jsonResponse(['success' => true]);
        break;

    case 'advance':
        $coach = requireAdmin();
        $data  = getInput();
        $sessionId = (int)($data['session_id'] ?? 0);

        $db   = getDB();
        $stmt = $db->prepare("SELECT * FROM eval_sessions WHERE id=? AND active=1");
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found or inactive'], 404);

        // Verify league ownership
        if ($coach['league_id'] !== null && $session['league_id'] != $coach['league_id']) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $skillIdx = (int)$session['current_skill_index'] + 1;
        $db->prepare("UPDATE eval_sessions SET current_skill_index=?, current_player_index=0 WHERE id=?")
           ->execute([$skillIdx, $sessionId]);
        jsonResponse(['skill_index' => $skillIdx]);
        break;

    case 'progress':
        requireLogin();
        $db = getDB();
        $sessionId = (int)($_GET['session_id'] ?? 0);
        if (!$sessionId) jsonResponse(['error' => 'session_id required'], 400);

        $stmt = $db->prepare("
            SELECT e.player_id, e.skill_index, AVG(e.score) as avg_score, COUNT(e.id) as coach_count
            FROM evaluations e
            WHERE e.session_id = ?
            GROUP BY e.player_id, e.skill_index
        ");
        $stmt->execute([$sessionId]);
        jsonResponse($stmt->fetchAll());
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
