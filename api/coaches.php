<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $db = getDB();
        if ($leagueId === null) {
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
            $stmt->execute([$leagueId]);
        }
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        $coach     = requireAdmin();
        $leagueId  = getEffectiveLeagueId($coach);
        $data      = getInput();
        $name      = trim($data['name'] ?? '');
        $pass      = $data['password'] ?? '';
        $makeAdmin = !empty($data['is_admin']) ? 1 : 0;

        if (!$name || !$pass) jsonResponse(['error' => 'Name and password required'], 400);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);

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
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data     = getInput();
        $id       = (int)($data['id'] ?? 0);

        $db   = getDB();
        $stmt = $db->prepare("SELECT is_admin, league_id FROM coaches WHERE id = ?");
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) jsonResponse(['error' => 'Coach not found'], 404);

        // Cannot delete superadmin
        if ($target['is_admin'] && $target['league_id'] === null) jsonResponse(['error' => 'Cannot delete superadmin'], 403);

        // Scope check: must belong to effective league
        if ($leagueId !== null && $target['league_id'] !== $leagueId) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("DELETE FROM coaches WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    case 'reset_password':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data     = getInput();
        $id       = (int)($data['id'] ?? 0);
        $newPass  = $data['new_password'] ?? '';

        if (!$id || !$newPass)    jsonResponse(['error' => 'ID and new password required'], 400);
        if (strlen($newPass) < 6) jsonResponse(['error' => 'Password must be at least 6 characters'], 400);

        $db   = getDB();
        $stmt = $db->prepare("SELECT is_admin, league_id FROM coaches WHERE id = ?");
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) jsonResponse(['error' => 'Coach not found'], 404);

        // Only superadmin can reset another superadmin account
        if ($target['is_admin'] && $target['league_id'] === null && $coach['league_id'] !== null) {
            jsonResponse(['error' => 'Cannot reset superadmin password'], 403);
        }
        // League admin can only reset within their own league
        if ($leagueId !== null && (int)$target['league_id'] !== $leagueId) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $hash = password_hash($newPass, PASSWORD_DEFAULT);
        $db->prepare("UPDATE coaches SET password = ? WHERE id = ?")->execute([$hash, $id]);
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

    case 'set_admin':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        $data     = getInput();
        $id       = (int)($data['id'] ?? 0);
        $makeAdmin = !empty($data['is_admin']) ? 1 : 0;

        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db   = getDB();
        $stmt = $db->prepare("SELECT is_admin, league_id FROM coaches WHERE id = ?");
        $stmt->execute([$id]);
        $target = $stmt->fetch();
        if (!$target) jsonResponse(['error' => 'Coach not found'], 404);

        // Cannot change superadmin status
        if ($target['league_id'] === null) jsonResponse(['error' => 'Cannot change superadmin status'], 403);

        // Cannot change your own admin status
        if ($id === (int)$coach['id']) jsonResponse(['error' => 'Cannot change your own admin status'], 403);

        // League admin can only manage coaches in their own league
        if ($leagueId !== null && (int)$target['league_id'] !== $leagueId) {
            jsonResponse(['error' => 'Access denied'], 403);
        }

        $db->prepare("UPDATE coaches SET is_admin = ? WHERE id = ?")->execute([$makeAdmin, $id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
