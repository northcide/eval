<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        requireAdmin();
        $db = getDB();
        $stmt = $db->query("SELECT id, name, is_admin, created_at FROM coaches ORDER BY is_admin DESC, name");
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        requireAdmin();
        $data = getInput();
        $name = trim($data['name'] ?? '');
        $pass = $data['password'] ?? '';

        if (!$name || !$pass) jsonResponse(['error' => 'Name and password required'], 400);

        $db   = getDB();
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        $stmt = $db->prepare("INSERT INTO coaches (name, password, is_admin) VALUES (?, ?, 0)");
        $stmt->execute([$name, $hash]);
        $id = $db->lastInsertId();
        jsonResponse(['id' => $id, 'name' => $name, 'is_admin' => false]);
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

    case 'delete':
        requireAdmin();
        $data = getInput();
        $id   = (int)($data['id'] ?? 0);

        // protect the admin account (id=1 or is_admin=1)
        $db   = getDB();
        $stmt = $db->prepare("SELECT is_admin FROM coaches WHERE id = ?");
        $stmt->execute([$id]);
        $coach = $stmt->fetch();
        if (!$coach || $coach['is_admin']) jsonResponse(['error' => 'Cannot delete admin'], 403);

        $db->prepare("DELETE FROM coaches WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
