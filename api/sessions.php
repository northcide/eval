<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {

    case 'active':
        // Returns all open sessions for the league (array)
        $coach    = requireLogin();
        $leagueId = getEffectiveLeagueId($coach);
        $db       = getDB();
        if ($leagueId !== null) {
            $stmt = $db->prepare(
                "SELECT id, name, active, started_at FROM eval_sessions
                 WHERE active=1 AND league_id=? ORDER BY id DESC"
            );
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query(
                "SELECT id, name, active, started_at FROM eval_sessions
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

        if ($leagueId !== null) {
            $stmt = $db->prepare("
                SELECT
                    s.id, s.name, s.active, s.started_at, s.ended_at,
                    COUNT(e.id)                 AS total_scores,
                    COUNT(DISTINCT e.coach_id)  AS coach_count,
                    COUNT(DISTINCT e.player_id) AS player_count,
                    MAX(e.created_at)           AS last_activity
                FROM eval_sessions s
                LEFT JOIN evaluations e ON e.session_id = s.id
                WHERE s.league_id = ?
                GROUP BY s.id, s.name, s.active, s.started_at, s.ended_at
                ORDER BY s.id DESC
            ");
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query("
                SELECT
                    s.id, s.name, s.active, s.started_at, s.ended_at,
                    COUNT(e.id)                 AS total_scores,
                    COUNT(DISTINCT e.coach_id)  AS coach_count,
                    COUNT(DISTINCT e.player_id) AS player_count,
                    MAX(e.created_at)           AS last_activity
                FROM eval_sessions s
                LEFT JOIN evaluations e ON e.session_id = s.id
                GROUP BY s.id, s.name, s.active, s.started_at, s.ended_at
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
        if ($leagueId !== null) {
            $stmt = $db->prepare(
                "SELECT id, name, active FROM eval_sessions WHERE league_id=? ORDER BY id DESC"
            );
            $stmt->execute([$leagueId]);
        } else {
            $stmt = $db->query(
                "SELECT id, name, active FROM eval_sessions ORDER BY id DESC"
            );
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $data = getInput();
        $name = trim($data['name'] ?? '');
        if (!$name) jsonResponse(['error' => 'Session name is required'], 400);
        if (mb_strlen($name) > 100) jsonResponse(['error' => 'Name too long (max 100 chars)'], 400);

        $db = getDB();
        $db->prepare("INSERT INTO eval_sessions (name, league_id, active) VALUES (?, ?, 1)")
           ->execute([$name, $leagueId]);
        $id = $db->lastInsertId();

        $row = $db->prepare("SELECT id, name, active, started_at, ended_at FROM eval_sessions WHERE id=?");
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
        $stmt = $db->prepare("SELECT league_id FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $row = $stmt->fetch();
        if (!$row) jsonResponse(['error' => 'Session not found'], 404);
        if ($leagueId !== null && $row['league_id'] != $leagueId) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("UPDATE eval_sessions SET active=0, ended_at=NOW() WHERE id=?")
           ->execute([$sessionId]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
