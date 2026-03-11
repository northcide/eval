<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
startSession();

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        $data = getInput();
        $login = trim($data['name'] ?? '');  // accepts email or name
        $pass  = $data['password'] ?? '';

        if (!$login || !$pass) jsonResponse(['error' => 'Login and password required'], 400);

        $db = getDB();
        // Try email first, then name
        $stmt = $db->prepare("SELECT * FROM coaches WHERE email = ? OR LOWER(name) = LOWER(?)");
        $stmt->execute([$login, $login]);
        $coach = $stmt->fetch();

        if (!$coach || !password_verify($pass, $coach['password'])) {
            jsonResponse(['error' => 'Invalid credentials'], 401);
        }

        // Build list of all leagues this coach belongs to
        $leagues = [];

        if ($coach['league_id'] === null && $coach['is_admin']) {
            // Superadmin — no league selection needed
        } elseif ($coach['league_id'] !== null) {
            // Native league
            $lStmt = $db->prepare("SELECT l.id, l.name FROM leagues l WHERE l.id = ?");
            $lStmt->execute([$coach['league_id']]);
            $homeLeague = $lStmt->fetch();
            if ($homeLeague) {
                $leagues[] = [
                    'id'       => (int)$homeLeague['id'],
                    'name'     => $homeLeague['name'],
                    'is_admin' => (bool)$coach['is_admin'],
                    'native'   => true,
                ];
            }
        }

        // Guest leagues via coach_leagues
        $clStmt = $db->prepare("
            SELECT l.id, l.name, cl.is_admin
            FROM coach_leagues cl
            JOIN leagues l ON l.id = cl.league_id
            WHERE cl.coach_id = ?
        ");
        $clStmt->execute([$coach['id']]);
        foreach ($clStmt->fetchAll() as $row) {
            $already = array_filter($leagues, fn($x) => $x['id'] === (int)$row['id']);
            if (!$already) {
                $leagues[] = [
                    'id'       => (int)$row['id'],
                    'name'     => $row['name'],
                    'is_admin' => (bool)$row['is_admin'],
                    'native'   => false,
                ];
            }
        }

        if ($coach['league_id'] === null && $coach['is_admin']) {
            // Superadmin — set session immediately
            $_SESSION['coach'] = [
                'id'        => (int)$coach['id'],
                'name'      => $coach['name'],
                'email'     => $coach['email'],
                'is_admin'  => true,
                'league_id' => null,
            ];
            jsonResponse(['success' => true, 'coach' => $_SESSION['coach']]);
        } elseif (count($leagues) === 1) {
            // Single league — set session immediately
            $_SESSION['coach'] = [
                'id'        => (int)$coach['id'],
                'name'      => $coach['name'],
                'email'     => $coach['email'],
                'is_admin'  => $leagues[0]['is_admin'],
                'league_id' => $leagues[0]['id'],
            ];
            jsonResponse(['success' => true, 'coach' => $_SESSION['coach']]);
        } elseif (count($leagues) > 1) {
            // Multiple leagues — store coach_id in session, ask frontend to pick
            $_SESSION['pending_coach_id'] = (int)$coach['id'];
            jsonResponse(['needs_league_select' => true, 'leagues' => $leagues]);
        } else {
            jsonResponse(['error' => 'No league assigned. Contact your administrator.'], 403);
        }
        break;

    case 'select_league':
        startSession();
        $pendingId = $_SESSION['pending_coach_id'] ?? null;
        if (!$pendingId) jsonResponse(['error' => 'No pending login'], 400);

        $data     = getInput();
        $leagueId = (int)($data['league_id'] ?? 0);
        if (!$leagueId) jsonResponse(['error' => 'League required'], 400);

        $db = getDB();
        $coach = $db->prepare("SELECT * FROM coaches WHERE id = ?");
        $coach->execute([$pendingId]);
        $coach = $coach->fetch();
        if (!$coach) jsonResponse(['error' => 'Session expired'], 401);

        // Check native membership
        $isAdmin = false;
        if ((int)$coach['league_id'] === $leagueId) {
            $isAdmin = (bool)$coach['is_admin'];
        } else {
            // Check coach_leagues
            $clStmt = $db->prepare("SELECT is_admin FROM coach_leagues WHERE coach_id = ? AND league_id = ?");
            $clStmt->execute([$pendingId, $leagueId]);
            $cl = $clStmt->fetch();
            if (!$cl) jsonResponse(['error' => 'Access denied'], 403);
            $isAdmin = (bool)$cl['is_admin'];
        }

        unset($_SESSION['pending_coach_id']);
        $_SESSION['coach'] = [
            'id'        => (int)$coach['id'],
            'name'      => $coach['name'],
            'email'     => $coach['email'],
            'is_admin'  => $isAdmin,
            'league_id' => $leagueId,
        ];
        jsonResponse(['success' => true, 'coach' => $_SESSION['coach']]);
        break;

    case 'my_leagues':
        $coach = requireLogin();
        $db    = getDB();
        $leagues = [];

        if ($coach['league_id'] !== null) {
            $stmt = $db->prepare("SELECT l.id, l.name FROM leagues l WHERE l.id = ?");
            $stmt->execute([$coach['league_id']]);
            $row = $stmt->fetch();
            if ($row) $leagues[] = ['id' => (int)$row['id'], 'name' => $row['name'], 'is_admin' => (bool)$coach['is_admin'], 'native' => true];
        }

        $stmt = $db->prepare("
            SELECT l.id, l.name, cl.is_admin
            FROM coach_leagues cl JOIN leagues l ON l.id = cl.league_id
            WHERE cl.coach_id = ?
        ");
        $stmt->execute([$coach['id']]);
        foreach ($stmt->fetchAll() as $row) {
            $already = array_filter($leagues, fn($x) => $x['id'] === (int)$row['id']);
            if (!$already) $leagues[] = ['id' => (int)$row['id'], 'name' => $row['name'], 'is_admin' => (bool)$row['is_admin'], 'native' => false];
        }

        jsonResponse(['leagues' => $leagues]);
        break;

    case 'logout':
        session_destroy();
        jsonResponse(['success' => true]);
        break;

    case 'me':
        if (!empty($_SESSION['coach'])) {
            jsonResponse(['coach' => $_SESSION['coach']]);
        } else {
            jsonResponse(['coach' => null]);
        }
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
