<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        $coach     = requireLogin();
        $leagueId  = getEffectiveLeagueId($coach);
        $db = getDB();
        if ($leagueId === null) {
            $stmt = $db->query("
                SELECT d.*, COUNT(p.id) as player_count, l.name as league_name
                FROM divisions d
                LEFT JOIN players p ON p.division_id = d.id
                LEFT JOIN leagues l ON l.id = d.league_id
                GROUP BY d.id
                ORDER BY l.name, d.name
            ");
        } else {
            $stmt = $db->prepare("
                SELECT d.*, COUNT(p.id) as player_count
                FROM divisions d
                LEFT JOIN players p ON p.division_id = d.id
                WHERE d.league_id = ?
                GROUP BY d.id
                ORDER BY d.name
            ");
            $stmt->execute([$leagueId]);
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $data = getInput();
        $name = trim($data['name'] ?? '');
        if (!$name) jsonResponse(['error' => 'Name required'], 400);

        $db = getDB();
        $stmt = $db->prepare("INSERT INTO divisions (name, league_id) VALUES (?, ?)");
        $stmt->execute([$name, $leagueId]);
        jsonResponse(['id' => $db->lastInsertId(), 'name' => $name, 'player_count' => 0]);
        break;

    case 'delete':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data = getInput();
        $id   = (int)($data['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db = getDB();
        if ($leagueId !== null) {
            $stmt = $db->prepare("SELECT league_id FROM divisions WHERE id = ?");
            $stmt->execute([$id]);
            $div = $stmt->fetch();
            if (!$div || $div['league_id'] != $leagueId) jsonResponse(['error' => 'Access denied'], 403);
        }
        $db->prepare("DELETE FROM divisions WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
