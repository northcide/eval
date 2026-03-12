<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

// Detect whether the eval_sessions table has a 'name' column and 'league_id' column
function sessionHasNameCol(PDO $db): bool {
    static $result = null;
    if ($result !== null) return $result;
    $stmt = $db->query("SHOW COLUMNS FROM eval_sessions LIKE 'name'");
    $result = $stmt->rowCount() > 0;
    return $result;
}
function sessionHasLeagueCol(PDO $db): bool {
    static $result = null;
    if ($result !== null) return $result;
    $stmt = $db->query("SHOW COLUMNS FROM eval_sessions LIKE 'league_id'");
    $result = $stmt->rowCount() > 0;
    return $result;
}

switch ($action) {

    case 'active':
        // Returns all open sessions for the league (array)
        $coach    = requireLogin();
        $leagueId = getEffectiveLeagueId($coach);
        $db       = getDB();
        $hasName   = sessionHasNameCol($db);
        $hasLeague = sessionHasLeagueCol($db);
        $nameExpr  = $hasName ? 'name' : "CONCAT('Session #', id)";

        if ($hasLeague && $leagueId !== null) {
            $stmt = $db->prepare(
                "SELECT id, ($nameExpr) AS name, active, bib_mode, started_at FROM eval_sessions
                 WHERE active=1 AND league_id=? ORDER BY id DESC"
            );
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query(
                "SELECT id, ($nameExpr) AS name, active, bib_mode, started_at FROM eval_sessions
                 WHERE active=1 ORDER BY id DESC"
            );
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'list':
        // Admin: sessions with aggregate stats
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $db       = getDB();
        $hasName   = sessionHasNameCol($db);
        $hasLeague = sessionHasLeagueCol($db);
        $nameExpr  = $hasName ? 's.name' : "CONCAT('Session #', s.id)";
        $groupExtra = $hasName ? ', s.name' : '';

        if ($hasLeague && $leagueId !== null) {
            $stmt = $db->prepare("
                SELECT
                    s.id, ($nameExpr) AS name, s.active, s.bib_mode, s.started_at, s.ended_at,
                    COUNT(e.id)                 AS total_scores,
                    COUNT(DISTINCT e.coach_id)  AS coach_count,
                    COUNT(DISTINCT e.player_id) AS player_count,
                    MAX(e.created_at)           AS last_activity
                FROM eval_sessions s
                LEFT JOIN evaluations e ON e.session_id = s.id
                WHERE s.league_id = ?
                GROUP BY s.id, s.active, s.bib_mode, s.started_at, s.ended_at$groupExtra
                ORDER BY s.id DESC
            ");
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query("
                SELECT
                    s.id, ($nameExpr) AS name, s.active, s.bib_mode, s.started_at, s.ended_at,
                    COUNT(e.id)                 AS total_scores,
                    COUNT(DISTINCT e.coach_id)  AS coach_count,
                    COUNT(DISTINCT e.player_id) AS player_count,
                    MAX(e.created_at)           AS last_activity
                FROM eval_sessions s
                LEFT JOIN evaluations e ON e.session_id = s.id
                GROUP BY s.id, s.active, s.bib_mode, s.started_at, s.ended_at$groupExtra
                ORDER BY s.id DESC
            ");
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'list_for_filter':
        // Lightweight list for Results dropdown
        $coach    = requireLogin();
        $leagueId = getEffectiveLeagueId($coach);
        $db       = getDB();
        $hasName   = sessionHasNameCol($db);
        $hasLeague = sessionHasLeagueCol($db);
        $nameExpr  = $hasName ? 'name' : "CONCAT('Session #', id)";

        if ($hasLeague && $leagueId !== null) {
            $stmt = $db->prepare(
                "SELECT id, ($nameExpr) AS name, active FROM eval_sessions WHERE league_id=? ORDER BY id DESC"
            );
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query(
                "SELECT id, ($nameExpr) AS name, active FROM eval_sessions ORDER BY id DESC"
            );
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data     = getInput();
        $db       = getDB();
        $hasName   = sessionHasNameCol($db);
        $hasLeague = sessionHasLeagueCol($db);
        $bibMode   = in_array($data['bib_mode'] ?? '', ['blank', 'numbered']) ? $data['bib_mode'] : 'blank';

        if ($hasName && $hasLeague) {
            // Full schema
            if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Session name is required'], 400);
            if (mb_strlen($name) > 100) jsonResponse(['error' => 'Name too long (max 100 chars)'], 400);
            $db->prepare("INSERT INTO eval_sessions (name, league_id, active, bib_mode) VALUES (?, ?, 1, ?)")
               ->execute([$name, $leagueId, $bibMode]);
        } else {
            // Simple schema (no name/league_id) — division_id required
            $divisionId = (int)($data['division_id'] ?? 0);
            if (!$divisionId) {
                // Default to first division if only one
                $first = $db->query("SELECT id FROM divisions ORDER BY id LIMIT 1")->fetch();
                $divisionId = $first ? (int)$first['id'] : 0;
            }
            if (!$divisionId) jsonResponse(['error' => 'No divisions available'], 400);
            $db->prepare("INSERT INTO eval_sessions (division_id, active, bib_mode) VALUES (?, 1, ?)")
               ->execute([$divisionId, $bibMode]);
        }
        $id = $db->lastInsertId();

        $nameExpr = $hasName ? 'name,' : "CONCAT('Session #', id) AS name,";
        $row = $db->prepare("SELECT id, $nameExpr active, bib_mode, started_at, ended_at FROM eval_sessions WHERE id=?");
        $row->execute([$id]);
        jsonResponse($row->fetch());
        break;

    case 'end':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data      = getInput();
        $sessionId = (int)($data['session_id'] ?? 0);
        if (!$sessionId) jsonResponse(['error' => 'session_id required'], 400);

        $db   = getDB();
        $hasLeague = sessionHasLeagueCol($db);
        $stmt = $db->prepare("SELECT id" . ($hasLeague ? ", league_id" : "") . " FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $row = $stmt->fetch();
        if (!$row) jsonResponse(['error' => 'Session not found'], 404);
        if ($hasLeague && $leagueId !== null && $row['league_id'] != $leagueId) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("UPDATE eval_sessions SET active=0, ended_at=NOW() WHERE id=?")
           ->execute([$sessionId]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
