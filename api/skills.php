<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        $coach    = requireLogin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $db   = getDB();
        $stmt = $db->prepare("SELECT id, name, sort_order FROM skills WHERE league_id = ? ORDER BY sort_order, id");
        $stmt->execute([$leagueId]);
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $data = getInput();
        $name = trim($data['name'] ?? '');
        if (!$name) jsonResponse(['error' => 'Skill name required'], 400);
        if (strlen($name) > 50) jsonResponse(['error' => 'Skill name too long (max 50 chars)'], 400);

        $db = getDB();
        $chk = $db->prepare("SELECT id FROM skills WHERE league_id = ? AND LOWER(name) = LOWER(?)");
        $chk->execute([$leagueId, $name]);
        if ($chk->fetch()) jsonResponse(['error' => 'A skill with that name already exists'], 409);

        $ord = $db->prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM skills WHERE league_id = ?");
        $ord->execute([$leagueId]);
        $nextOrder = (int)$ord->fetchColumn();

        $stmt = $db->prepare("INSERT INTO skills (league_id, name, sort_order) VALUES (?, ?, ?)");
        $stmt->execute([$leagueId, $name, $nextOrder]);
        jsonResponse(['id' => (int)$db->lastInsertId(), 'name' => $name, 'sort_order' => $nextOrder]);
        break;

    case 'delete':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $data = getInput();
        $id   = (int)($data['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db   = getDB();
        $stmt = $db->prepare("SELECT league_id FROM skills WHERE id = ?");
        $stmt->execute([$id]);
        $skill = $stmt->fetch();
        if (!$skill || (int)$skill['league_id'] !== $leagueId) jsonResponse(['error' => 'Access denied'], 403);

        $db->prepare("DELETE FROM skills WHERE id = ?")->execute([$id]);

        // Renumber sort_order to keep it compact
        $remaining = $db->prepare("SELECT id FROM skills WHERE league_id = ? ORDER BY sort_order, id");
        $remaining->execute([$leagueId]);
        $reorder = $db->prepare("UPDATE skills SET sort_order = ? WHERE id = ?");
        foreach ($remaining->fetchAll() as $i => $row) {
            $reorder->execute([$i, $row['id']]);
        }
        jsonResponse(['success' => true]);
        break;

    case 'reorder':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);
        $data = getInput();
        $ids  = $data['ids'] ?? [];
        if (!is_array($ids) || !count($ids)) jsonResponse(['error' => 'ids array required'], 400);

        $db   = getDB();
        $stmt = $db->prepare("UPDATE skills SET sort_order = ? WHERE id = ? AND league_id = ?");
        foreach ($ids as $order => $id) {
            $stmt->execute([$order, (int)$id, $leagueId]);
        }
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
