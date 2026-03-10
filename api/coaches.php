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
