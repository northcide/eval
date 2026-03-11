<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
startSession();

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        $data = getInput();
        $name = trim($data['name'] ?? '');
        $pass = $data['password'] ?? '';

        if (!$name || !$pass) {
            jsonResponse(['error' => 'Name and password required'], 400);
        }

        $db = getDB();
        $stmt = $db->prepare("SELECT * FROM coaches WHERE LOWER(name) = LOWER(?)");
        $stmt->execute([$name]);
        $coach = $stmt->fetch();

        if (!$coach || !password_verify($pass, $coach['password'])) {
            jsonResponse(['error' => 'Invalid name or password'], 401);
        }

        $_SESSION['coach'] = [
            'id'       => $coach['id'],
            'name'     => $coach['name'],
            'is_admin' => (bool)$coach['is_admin'],
            'league_id'=> $coach['league_id'] !== null ? (int)$coach['league_id'] : null,
        ];

        jsonResponse(['success' => true, 'coach' => $_SESSION['coach']]);
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
