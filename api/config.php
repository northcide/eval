<?php
// ─── Database Configuration ───────────────────────────────────────────────────
// Edit these values to match your server
define('DB_HOST', 'localhost');
define('DB_NAME', 'scout_pro');
define('DB_USER', 'scout_pro');  // dedicated MySQL user
define('DB_PASS', 'scoutpro2026'); // MySQL password
define('DB_CHARSET', 'utf8mb4');

// ─── Session config ───────────────────────────────────────────────────────────
define('SESSION_NAME', 'scout_pro_session');
define('SESSION_LIFETIME', 86400); // 24 hours

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            http_response_code(500);
            die(json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]));
        }
    }
    return $pdo;
}

function startSession(): void {
    ini_set('session.name', SESSION_NAME);
    ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function requireLogin(): array {
    startSession();
    if (empty($_SESSION['coach'])) {
        http_response_code(401);
        die(json_encode(['error' => 'Not authenticated']));
    }
    return $_SESSION['coach'];
}

function requireAdmin(): array {
    $coach = requireLogin();
    if (empty($coach['is_admin'])) {
        http_response_code(403);
        die(json_encode(['error' => 'Admin access required']));
    }
    return $coach;
}

function requireSuperAdmin(): array {
    $coach = requireLogin();
    if (empty($coach['is_admin']) || $coach['league_id'] !== null) {
        http_response_code(403);
        die(json_encode(['error' => 'Superadmin access required']));
    }
    return $coach;
}

// When superadmin is managing a league, they pass managing_league_id as a param.
// Returns the effective league_id to use for scoping queries.
function getEffectiveLeagueId(array $coach): ?int {
    if ($coach['league_id'] !== null) return (int)$coach['league_id'];
    // Superadmin: check for managing_league_id in GET or POST body
    $raw = $_GET['managing_league_id'] ?? null;
    if ($raw === null) {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $raw  = $body['managing_league_id'] ?? null;
    }
    return $raw !== null ? (int)$raw : null;
}

function jsonResponse(mixed $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function getInput(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}
