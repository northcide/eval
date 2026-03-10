<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        requireLogin();
        $db = getDB();
        $stmt = $db->query("
            SELECT d.*, COUNT(p.id) as player_count
            FROM divisions d
            LEFT JOIN players p ON p.division_id = d.id
            GROUP BY d.id
            ORDER BY d.name
        ");
        jsonResponse($stmt->fetchAll());
        break;

    case 'create':
        requireAdmin();
        $data = getInput();
        $name = trim($data['name'] ?? '');
        if (!$name) jsonResponse(['error' => 'Name required'], 400);

        $db = getDB();
        $stmt = $db->prepare("INSERT INTO divisions (name) VALUES (?)");
        $stmt->execute([$name]);
        jsonResponse(['id' => $db->lastInsertId(), 'name' => $name, 'player_count' => 0]);
        break;

    case 'delete':
        requireAdmin();
        $data = getInput();
        $id = (int)($data['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db = getDB();
        $db->prepare("DELETE FROM divisions WHERE id = ?")->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
