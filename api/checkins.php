<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {

    // Lightweight session list for CheckIn tab (works with actual DB schema)
    case 'sessions':
        requireAdmin();
        $db = getDB();
        $stmt = $db->query("
            SELECT s.id, s.bib_mode, s.active, s.started_at,
                   d.name AS division_name
            FROM eval_sessions s
            JOIN divisions d ON d.id = s.division_id
            WHERE s.active = 1
            ORDER BY s.id DESC
        ");
        jsonResponse($stmt->fetchAll());
        break;

    case 'list':
        requireAdmin();
        $sessionId = (int)($_GET['session_id'] ?? 0);
        if (!$sessionId) jsonResponse(['error' => 'session_id required'], 400);

        $db = getDB();

        $sesStmt = $db->prepare("
            SELECT s.id, s.bib_mode, s.active, s.started_at,
                   d.name AS division_name
            FROM eval_sessions s
            JOIN divisions d ON d.id = s.division_id
            WHERE s.id = ?
        ");
        $sesStmt->execute([$sessionId]);
        $session = $sesStmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found'], 404);

        $stmt = $db->prepare("
            SELECT p.id AS player_id, p.name AS player_name, p.division_id,
                   d.name AS division_name,
                   c.bib_number, c.checked_in, c.checked_in_at
            FROM players p
            JOIN divisions d ON d.id = p.division_id
            LEFT JOIN session_checkins c ON c.player_id = p.id AND c.session_id = ?
            WHERE p.division_id = (SELECT division_id FROM eval_sessions WHERE id = ?)
            ORDER BY c.bib_number IS NULL, c.bib_number, p.name
        ");
        $stmt->execute([$sessionId, $sessionId]);
        $players = $stmt->fetchAll();

        jsonResponse(['session' => $session, 'players' => $players]);
        break;

    case 'auto_assign':
        requireAdmin();
        $data      = getInput();
        $sessionId = (int)($data['session_id'] ?? 0);
        if (!$sessionId) jsonResponse(['error' => 'session_id required'], 400);

        $db = getDB();

        $stmt = $db->prepare("SELECT id, bib_mode, division_id FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found'], 404);
        if ($session['bib_mode'] !== 'blank') jsonResponse(['error' => 'auto_assign only valid for blank bib mode'], 400);

        $maxStmt = $db->prepare("SELECT COALESCE(MAX(bib_number), 0) AS maxbib FROM session_checkins WHERE session_id=?");
        $maxStmt->execute([$sessionId]);
        $nextBib = (int)$maxStmt->fetchColumn() + 1;

        $stmt = $db->prepare("
            SELECT p.id FROM players p
            LEFT JOIN session_checkins c ON c.player_id = p.id AND c.session_id = ?
            WHERE p.division_id = ? AND c.id IS NULL
            ORDER BY p.name
        ");
        $stmt->execute([$sessionId, $session['division_id']]);
        $players = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $ins = $db->prepare("INSERT INTO session_checkins (session_id, player_id, bib_number, checked_in) VALUES (?, ?, ?, 0)");
        $assigned = 0;
        foreach ($players as $pid) {
            $ins->execute([$sessionId, $pid, $nextBib]);
            $nextBib++;
            $assigned++;
        }

        jsonResponse(['assigned' => $assigned]);
        break;

    case 'checkin':
        requireAdmin();
        $data      = getInput();
        $sessionId = (int)($data['session_id'] ?? 0);
        $playerId  = (int)($data['player_id']  ?? 0);
        if (!$sessionId || !$playerId) jsonResponse(['error' => 'session_id and player_id required'], 400);

        $db = getDB();

        $stmt = $db->prepare("SELECT id, bib_mode FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found'], 404);

        if ($session['bib_mode'] === 'blank') {
            $upd = $db->prepare("UPDATE session_checkins SET checked_in=1, checked_in_at=NOW() WHERE session_id=? AND player_id=?");
            $upd->execute([$sessionId, $playerId]);
            if ($upd->rowCount() === 0) jsonResponse(['error' => 'No bib assignment found for this player. Run auto-assign first.'], 404);
        } else {
            $bibNumber = isset($data['bib_number']) ? (int)$data['bib_number'] : 0;
            if ($bibNumber < 1 || $bibNumber > 999) jsonResponse(['error' => 'Bib number must be between 1 and 999'], 400);
            try {
                $ins = $db->prepare("INSERT INTO session_checkins (session_id, player_id, bib_number, checked_in, checked_in_at) VALUES (?, ?, ?, 1, NOW())");
                $ins->execute([$sessionId, $playerId, $bibNumber]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') {
                    $conflict = $db->prepare("SELECT p.name FROM session_checkins sc JOIN players p ON p.id = sc.player_id WHERE sc.session_id=? AND sc.bib_number=?");
                    $conflict->execute([$sessionId, $bibNumber]);
                    $row = $conflict->fetch();
                    $owner = $row ? $row['name'] : 'another player';
                    jsonResponse(['error' => 'Bib ' . str_pad($bibNumber, 3, '0', STR_PAD_LEFT) . ' is already assigned to ' . $owner], 409);
                }
                throw $e;
            }
        }

        $sel = $db->prepare("SELECT player_id, bib_number, checked_in, checked_in_at FROM session_checkins WHERE session_id=? AND player_id=?");
        $sel->execute([$sessionId, $playerId]);
        jsonResponse($sel->fetch());
        break;

    case 'undo':
        requireAdmin();
        $data      = getInput();
        $sessionId = (int)($data['session_id'] ?? 0);
        $playerId  = (int)($data['player_id']  ?? 0);
        if (!$sessionId || !$playerId) jsonResponse(['error' => 'session_id and player_id required'], 400);

        $db = getDB();

        $stmt = $db->prepare("SELECT id, bib_mode FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found'], 404);

        if ($session['bib_mode'] === 'blank') {
            $db->prepare("UPDATE session_checkins SET checked_in=0, checked_in_at=NULL WHERE session_id=? AND player_id=?")
               ->execute([$sessionId, $playerId]);
        } else {
            $db->prepare("DELETE FROM session_checkins WHERE session_id=? AND player_id=?")
               ->execute([$sessionId, $playerId]);
        }

        jsonResponse(['success' => true]);
        break;

    case 'session_bibs':
        requireLogin();
        $sessionId = (int)($_GET['session_id'] ?? 0);
        if (!$sessionId) jsonResponse(['error' => 'session_id required'], 400);

        $db = getDB();

        $stmt = $db->prepare("SELECT id, bib_mode FROM eval_sessions WHERE id=?");
        $stmt->execute([$sessionId]);
        $session = $stmt->fetch();
        if (!$session) jsonResponse(['error' => 'Session not found'], 404);

        $bibs = $db->prepare("SELECT player_id, bib_number FROM session_checkins WHERE session_id=? AND checked_in=1");
        $bibs->execute([$sessionId]);

        jsonResponse(['bib_mode' => $session['bib_mode'], 'bibs' => $bibs->fetchAll()]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
