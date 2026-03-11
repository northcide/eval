<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        $coach = requireAdmin();
        $db    = getDB();
        if ($coach['league_id'] === null) {
            // Superadmin: all leagues
            $stmt = $db->query("
                SELECT l.*,
                    COUNT(DISTINCT c.id) as coach_count,
                    COUNT(DISTINCT d.id) as division_count
                FROM leagues l
                LEFT JOIN coaches c ON c.league_id = l.id
                LEFT JOIN divisions d ON d.league_id = l.id
                GROUP BY l.id
                ORDER BY l.name
            ");
        } else {
            // League admin: only their own league
            $stmt = $db->prepare("
                SELECT l.*,
                    COUNT(DISTINCT c.id) as coach_count,
                    COUNT(DISTINCT d.id) as division_count
                FROM leagues l
                LEFT JOIN coaches c ON c.league_id = l.id
                LEFT JOIN divisions d ON d.league_id = l.id
                WHERE l.id = ?
                GROUP BY l.id
            ");
            $stmt->execute([(int)$coach['league_id']]);
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        requireSuperAdmin();
        $data       = getInput();
        $leagueName = trim($data['league_name'] ?? '');
        $adminName  = trim($data['admin_name'] ?? '');
        $adminPass  = $data['admin_password'] ?? '';

        if (!$leagueName) jsonResponse(['error' => 'League name required'], 400);
        if (!$adminName)  jsonResponse(['error' => 'Admin name required'], 400);
        if (!$adminPass)  jsonResponse(['error' => 'Admin password required'], 400);
        if (strlen($adminPass) < 6) jsonResponse(['error' => 'Password must be at least 6 characters'], 400);

        $db = getDB();
        try {
            $db->beginTransaction();
            $db->prepare("INSERT INTO leagues (name) VALUES (?)")->execute([$leagueName]);
            $leagueId = $db->lastInsertId();

            $hash = password_hash($adminPass, PASSWORD_DEFAULT);
            $db->prepare("INSERT INTO coaches (name, password, is_admin, league_id) VALUES (?, ?, 1, ?)")
               ->execute([$adminName, $hash, $leagueId]);

            // Insert default skills
            $defaultSkills = ['Running', 'Fielding', 'Pitching', 'Hitting'];
            $skillStmt = $db->prepare("INSERT INTO skills (league_id, name, sort_order) VALUES (?, ?, ?)");
            foreach ($defaultSkills as $i => $skill) {
                $skillStmt->execute([$leagueId, $skill, $i]);
            }

            $db->commit();
            jsonResponse(['id' => $leagueId, 'name' => $leagueName, 'admin_name' => $adminName]);
        } catch (PDOException $e) {
            $db->rollBack();
            if ($e->getCode() === '23000') jsonResponse(['error' => 'League name or admin name already exists'], 409);
            throw $e;
        }
        break;

    case 'delete':
        requireSuperAdmin();
        $data = getInput();
        $id   = (int)($data['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db = getDB();
        // Check no active sessions
        $stmt = $db->prepare("SELECT COUNT(*) FROM eval_sessions WHERE league_id = ? AND active = 1");
        $stmt->execute([$id]);
        if ($stmt->fetchColumn() > 0) jsonResponse(['error' => 'Cannot delete league with active evaluation sessions'], 409);

        $db->prepare("DELETE FROM leagues WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
