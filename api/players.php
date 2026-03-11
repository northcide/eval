<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

// Shared position display SQL fragment
$positionExpr = "CASE WHEN p.is_pitcher=1 AND p.is_catcher=1 THEN 'Pitcher/Catcher'
     WHEN p.is_pitcher=1 THEN 'Pitcher'
     WHEN p.is_catcher=1 THEN 'Catcher'
     ELSE 'Player' END as position";

switch ($action) {
    case 'list':
        $coach = requireLogin();
        $db = getDB();
        $divisionId = isset($_GET['division_id']) ? (int)$_GET['division_id'] : null;

        if ($divisionId) {
            $where  = 'p.division_id = ?';
            $params = [$divisionId];
            if ($coach['league_id'] !== null) {
                $where  .= ' AND d.league_id = ?';
                $params[] = $coach['league_id'];
            }
            $stmt = $db->prepare("
                SELECT p.*, d.name as division_name, $positionExpr
                FROM players p
                LEFT JOIN divisions d ON d.id = p.division_id
                WHERE $where
                ORDER BY p.name
            ");
            $stmt->execute($params);
        } else {
            if ($coach['league_id'] !== null) {
                $stmt = $db->prepare("
                    SELECT p.*, d.name as division_name, $positionExpr
                    FROM players p
                    LEFT JOIN divisions d ON d.id = p.division_id
                    WHERE d.league_id = ?
                    ORDER BY d.name, p.name
                ");
                $stmt->execute([$coach['league_id']]);
            } else {
                $stmt = $db->query("
                    SELECT p.*, d.name as division_name, $positionExpr
                    FROM players p
                    LEFT JOIN divisions d ON d.id = p.division_id
                    ORDER BY d.name, p.name
                ");
            }
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach = requireAdmin();
        if ($coach['league_id'] === null) jsonResponse(['error' => 'Superadmin cannot create players directly'], 400);
        $data       = getInput();
        $name       = trim($data['name'] ?? '');
        $age        = isset($data['age']) && $data['age'] !== '' ? (int)$data['age'] : null;
        $isPitcher  = empty($data['is_pitcher']) ? 0 : 1;
        $isCatcher  = empty($data['is_catcher']) ? 0 : 1;
        $divisionId = (int)($data['division_id'] ?? 0) ?: null;

        if (!$name) jsonResponse(['error' => 'Name required'], 400);

        $db = getDB();

        // Verify division belongs to this league
        if ($divisionId) {
            $stmt = $db->prepare("SELECT league_id FROM divisions WHERE id = ?");
            $stmt->execute([$divisionId]);
            $div = $stmt->fetch();
            if (!$div || $div['league_id'] != $coach['league_id']) jsonResponse(['error' => 'Division not in your league'], 403);
        }

        $db->prepare("INSERT INTO players (name, age, is_pitcher, is_catcher, division_id) VALUES (?, ?, ?, ?, ?)")
           ->execute([$name, $age, $isPitcher, $isCatcher, $divisionId]);
        $id = $db->lastInsertId();

        $row = $db->prepare("SELECT p.*, d.name as division_name, $positionExpr FROM players p LEFT JOIN divisions d ON d.id=p.division_id WHERE p.id=?");
        $row->execute([$id]);
        jsonResponse($row->fetch());
        break;

    case 'import':
        $coach = requireAdmin();
        if ($coach['league_id'] === null) jsonResponse(['error' => 'Superadmin cannot import players directly'], 400);
        $data   = getInput();
        $rows   = $data['players'] ?? [];
        $defDiv = isset($data['default_division_id']) ? (int)$data['default_division_id'] : null;

        if (!is_array($rows) || !count($rows)) jsonResponse(['error' => 'No players'], 400);

        $db   = getDB();
        $stmt = $db->prepare("INSERT INTO players (name, age, is_pitcher, is_catcher, division_id) VALUES (?, ?, ?, ?, ?)");
        $count = 0;
        foreach ($rows as $r) {
            $name = trim($r['name'] ?? '');
            if (!$name) continue;
            $age       = isset($r['age']) && $r['age'] !== '' ? (int)$r['age'] : null;
            $isPitcher = empty($r['is_pitcher']) ? 0 : 1;
            $isCatcher = empty($r['is_catcher']) ? 0 : 1;
            $divId     = isset($r['division_id']) ? (int)$r['division_id'] : $defDiv;
            $stmt->execute([$name, $age, $isPitcher, $isCatcher, $divId ?: null]);
            $count++;
        }
        jsonResponse(['imported' => $count]);
        break;

    case 'update':
        $coach = requireAdmin();
        $data = getInput();
        $id         = (int)($data['id'] ?? 0);
        $name       = trim($data['name'] ?? '');
        $age        = isset($data['age']) && $data['age'] !== '' ? (int)$data['age'] : null;
        $isPitcher  = empty($data['is_pitcher']) ? 0 : 1;
        $isCatcher  = empty($data['is_catcher']) ? 0 : 1;
        $divisionId = (int)($data['division_id'] ?? 0) ?: null;

        if (!$id)   jsonResponse(['error' => 'ID required'], 400);
        if (!$name) jsonResponse(['error' => 'Name required'], 400);

        $db = getDB();

        // Verify player belongs to this league
        if ($coach['league_id'] !== null) {
            $stmt = $db->prepare("SELECT d.league_id FROM players p LEFT JOIN divisions d ON d.id=p.division_id WHERE p.id=?");
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row || $row['league_id'] != $coach['league_id']) jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("UPDATE players SET name=?, age=?, is_pitcher=?, is_catcher=?, division_id=? WHERE id=?")
           ->execute([$name, $age, $isPitcher, $isCatcher, $divisionId, $id]);
        jsonResponse(['success' => true]);
        break;

    case 'delete':
        $coach = requireAdmin();
        $data = getInput();
        $id = (int)($data['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db = getDB();

        // Verify player belongs to this league
        if ($coach['league_id'] !== null) {
            $stmt = $db->prepare("SELECT d.league_id FROM players p LEFT JOIN divisions d ON d.id=p.division_id WHERE p.id=?");
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row || $row['league_id'] != $coach['league_id']) jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("DELETE FROM players WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
