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
                SELECT c.id, c.name, c.email, c.created_at,
                       COALESCE(cl.is_admin, c.is_admin) as is_admin,
                       CASE WHEN c.league_id = :lid THEN 0 ELSE 1 END as is_guest,
                       l.name as league_name
                FROM coaches c
                LEFT JOIN coach_leagues cl ON cl.coach_id = c.id AND cl.league_id = :lid2
                LEFT JOIN leagues l ON l.id = COALESCE(cl.league_id, c.league_id)
                WHERE c.league_id = :lid3 OR cl.league_id = :lid4
                ORDER BY is_admin DESC, c.name
            ");
            $stmt->execute([':lid' => $leagueId, ':lid2' => $leagueId, ':lid3' => $leagueId, ':lid4' => $leagueId]);
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
        $email = trim($data['email'] ?? '') ?: null;

        if (!$name || !$pass) jsonResponse(['error' => 'Name and password required'], 400);
        if ($leagueId === null) jsonResponse(['error' => 'No league selected'], 400);

        $db   = getDB();
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        try {
            $stmt = $db->prepare("INSERT INTO coaches (name, email, password, is_admin, league_id) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$name, $email, $hash, $makeAdmin, $leagueId]);
            $id = $db->lastInsertId();
            jsonResponse(['id' => $id, 'name' => $name, 'is_admin' => (bool)$makeAdmin, 'league_id' => $leagueId]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['error' => 'A coach with that name or email already exists'], 409);
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

        if ($leagueId !== null) {
            // Is this coach a guest in this league?
            $clStmt = $db->prepare("SELECT 1 FROM coach_leagues WHERE coach_id = ? AND league_id = ?");
            $clStmt->execute([$id, $leagueId]);
            if ($clStmt->fetch()) {
                // Remove guest membership only
                $db->prepare("DELETE FROM coach_leagues WHERE coach_id = ? AND league_id = ?")->execute([$id, $leagueId]);
                jsonResponse(['success' => true, 'removed_from_league' => true]);
                break;
            }
            // Native coach — scope check
            if ((int)$target['league_id'] !== $leagueId) jsonResponse(['error' => 'Access denied'], 403);
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

        // Check if guest
        if ($leagueId !== null) {
            $clStmt = $db->prepare("SELECT 1 FROM coach_leagues WHERE coach_id = ? AND league_id = ?");
            $clStmt->execute([$id, $leagueId]);
            if ($clStmt->fetch()) {
                $db->prepare("UPDATE coach_leagues SET is_admin = ? WHERE coach_id = ? AND league_id = ?")->execute([$makeAdmin, $id, $leagueId]);
                jsonResponse(['success' => true]);
                break;
            }
        }

        $db->prepare("UPDATE coaches SET is_admin = ? WHERE id = ?")->execute([$makeAdmin, $id]);
        jsonResponse(['success' => true]);
        break;

    case 'add_to_league':
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if (!$leagueId) jsonResponse(['error' => 'No league context'], 400);

        $data     = getInput();
        $targetId = (int)($data['coach_id'] ?? 0);
        $isAdmin  = !empty($data['is_admin']) ? 1 : 0;
        if (!$targetId) jsonResponse(['error' => 'coach_id required'], 400);

        $db = getDB();
        $stmt = $db->prepare("SELECT id, is_admin, league_id FROM coaches WHERE id = ?");
        $stmt->execute([$targetId]);
        $target = $stmt->fetch();
        if (!$target) jsonResponse(['error' => 'Coach not found'], 404);
        if ($target['league_id'] === null) jsonResponse(['error' => 'Cannot add superadmin to a league'], 403);
        if ((int)$target['league_id'] === $leagueId) jsonResponse(['error' => 'Coach already belongs to this league'], 409);

        try {
            $db->prepare("INSERT INTO coach_leagues (coach_id, league_id, is_admin) VALUES (?, ?, ?)")
               ->execute([$targetId, $leagueId, $isAdmin]);
            jsonResponse(['success' => true]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonResponse(['error' => 'Coach is already in this league'], 409);
            throw $e;
        }
        break;

    case 'search':
        // Search coaches not already in a given league (for add-to-league UI)
        $coach    = requireAdmin();
        $leagueId = getEffectiveLeagueId($coach);
        if (!$leagueId) jsonResponse(['error' => 'No league context'], 400);

        $db = getDB();
        $q  = '%' . trim($_GET['q'] ?? '') . '%';
        $stmt = $db->prepare("
            SELECT c.id, c.name, c.email
            FROM coaches c
            WHERE c.league_id IS NOT NULL
              AND c.league_id != ?
              AND c.id NOT IN (SELECT coach_id FROM coach_leagues WHERE league_id = ?)
              AND (c.name LIKE ? OR c.email LIKE ?)
            ORDER BY c.name
            LIMIT 20
        ");
        $stmt->execute([$leagueId, $leagueId, $q, $q]);
        jsonResponse($stmt->fetchAll());
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
