<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        $coach = requireAdmin();
        $db = getDB();
        if ($coach['league_id'] === null) {
            // Superadmin: list all coaches with league info
            $stmt = $db->query("
                SELECT c.id, c.name, c.is_admin, c.league_id, c.created_at,
                       l.name as league_name
                FROM coaches c
                LEFT JOIN leagues l ON l.id = c.league_id
                ORDER BY l.name, c.is_admin DESC, c.name
            ");
        } else {
            $stmt = $db->prepare("
                SELECT c.id, c.name, c.is_admin, c.league_id, c.created_at,
                       l.name as league_name
                FROM coaches c
                LEFT JOIN leagues l ON l.id = c.league_id
                WHERE c.league_id = ?
                ORDER BY c.is_admin DESC, c.name
            ");
            $stmt->execute([$coach['league_id']]);
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach = requireAdmin();
        $data  = getInput();
        $name  = trim($data['name'] ?? '');
        $pass  = $data['password'] ?? '';
        $makeAdmin = !empty($data['is_admin']) ? 1 : 0;

        if (!$name || !$pass) jsonResponse(['error' => 'Name and password required'], 400);

        // League admins can only create coaches in their own league
        $leagueId = $coach['league_id'];
        if ($leagueId === null) jsonResponse(['error' => 'Superadmin cannot create coaches directly. Create a league first.'], 400);

        $db   = getDB();
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        try {
            $stmt = $db->prepare("INSERT INTO coaches (name, password, is_admin, league_id) VALUES (?, ?, ?, ?)");
            $stmt->execute([$name, $hash, $makeAdmin, $leagueId]);
            $id = $db->lastInsertId();
            jsonResponse(['id' => $id, 'name' => $name, 'is_admin' => (bool)$makeAdmin, 'league_id' => $leagueId]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['error' => 'A coach with that name already exists in this league'], 409);
            throw $e;
        }
        break;

    case 'delete':
        $coach = requireAdmin();
        $data  = getInput();
        $id    = (int)($data['id'] ?? 0);

        $db   = getDB();
        $stmt = $db->prepare("SELECT is_admin, league_id FROM coaches WHERE id = ?");
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) jsonResponse(['error' => 'Coach not found'], 404);

        // Cannot delete superadmin
        if ($target['is_admin'] && $target['league_id'] === null) jsonResponse(['error' => 'Cannot delete superadmin'], 403);

        // League admin can only delete coaches in own league
        if ($coach['league_id'] !== null && $target['league_id'] !== $coach['league_id']) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("DELETE FROM coaches WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    case 'change_password':
        requireLogin();
        $data    = getInput();
        $current = $data['current_password'] ?? '';
        $new     = $data['new_password'] ?? '';

        if (!$current || !$new) jsonResponse(['error' => 'Current and new password required'], 400);
        if (strlen($new) < 6)   jsonResponse(['error' => 'New password must be at least 6 characters'], 400);

        $db   = getDB();
        $stmt = $db->prepare("SELECT password FROM coaches WHERE id = ?");
        $stmt->execute([$_SESSION['coach']['id']]);
        $row  = $stmt->fetch();

        if (!$row || !password_verify($current, $row['password'])) {
            jsonResponse(['error' => 'Current password is incorrect'], 401);
        }

        $hash = password_hash($new, PASSWORD_DEFAULT);
        $db->prepare("UPDATE coaches SET password = ? WHERE id = ?")->execute([$hash, $_SESSION['coach']['id']]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
