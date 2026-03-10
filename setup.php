<?php
/**
 * Scout Pro — Installer
 * Visit this file once in your browser to set up the database.
 * It will delete itself when done.
 */

$error   = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $host    = trim($_POST['db_host']    ?? 'localhost');
    $name    = trim($_POST['db_name']    ?? '');
    $user    = trim($_POST['db_user']    ?? '');
    $pass    =      $_POST['db_pass']    ?? '';
    $apass   =      $_POST['admin_pass'] ?? 'admin123';
    $appurl  = rtrim(trim($_POST['app_url'] ?? ''), '/');

    if (!$name || !$user) {
        $error = 'Database name and username are required.';
    } else {
        try {
            // Connect without selecting a DB first
            $pdo = new PDO(
                "mysql:host={$host};charset=utf8mb4",
                $user, $pass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );

            // Create DB
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("USE `{$name}`");

            // Create tables
            $pdo->exec("CREATE TABLE IF NOT EXISTS divisions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )");

            $pdo->exec("CREATE TABLE IF NOT EXISTS coaches (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL,
                is_admin TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )");

            $pdo->exec("CREATE TABLE IF NOT EXISTS players (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                age INT,
                is_pitcher TINYINT(1) DEFAULT 0,
                is_catcher TINYINT(1) DEFAULT 0,
                division_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL
            )");

            $pdo->exec("CREATE TABLE IF NOT EXISTS eval_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                division_id INT NOT NULL,
                current_skill_index INT DEFAULT 0,
                current_player_index INT DEFAULT 0,
                active TINYINT(1) DEFAULT 1,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP NULL,
                FOREIGN KEY (division_id) REFERENCES divisions(id)
            )");

            $pdo->exec("CREATE TABLE IF NOT EXISTS evaluations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                player_id INT NOT NULL,
                coach_id INT NOT NULL,
                skill_index INT NOT NULL,
                skill_name VARCHAR(50) NOT NULL,
                score INT NOT NULL CHECK (score >= 1 AND score <= 10),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_eval (session_id, player_id, coach_id, skill_index),
                FOREIGN KEY (session_id) REFERENCES eval_sessions(id),
                FOREIGN KEY (player_id) REFERENCES players(id),
                FOREIGN KEY (coach_id) REFERENCES coaches(id)
            )");

            // Insert admin account
            $hash = password_hash($apass, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT IGNORE INTO coaches (name, password, is_admin) VALUES ('Administrator', ?, 1)");
            $stmt->execute([$hash]);

            // Write config.php
            $config = <<<PHP
<?php
define('DB_HOST',    '{$host}');
define('DB_NAME',    '{$name}');
define('DB_USER',    '{$user}');
define('DB_PASS',    '{$pass}');
define('DB_CHARSET', 'utf8mb4');

define('SESSION_NAME',     'scout_pro_session');
define('SESSION_LIFETIME', 86400);

function getDB(): PDO {
    static \$pdo = null;
    if (\$pdo === null) {
        \$dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        \$options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            \$pdo = new PDO(\$dsn, DB_USER, DB_PASS, \$options);
        } catch (PDOException \$e) {
            http_response_code(500);
            die(json_encode(['error' => 'Database connection failed: ' . \$e->getMessage()]));
        }
    }
    return \$pdo;
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
    if (empty(\$_SESSION['coach'])) {
        http_response_code(401);
        die(json_encode(['error' => 'Not authenticated']));
    }
    return \$_SESSION['coach'];
}

function requireAdmin(): array {
    \$coach = requireLogin();
    if (empty(\$coach['is_admin'])) {
        http_response_code(403);
        die(json_encode(['error' => 'Admin access required']));
    }
    return \$coach;
}

function jsonResponse(mixed \$data, int \$status = 200): void {
    http_response_code(\$status);
    header('Content-Type: application/json');
    echo json_encode(\$data);
    exit;
}

function getInput(): array {
    \$raw = file_get_contents('php://input');
    return json_decode(\$raw, true) ?? [];
}
PHP;
            file_put_contents(__DIR__ . '/api/config.php', $config);

            // Update manifest.json and sw.js with correct app URL if provided
            if ($appurl) {
                $manifest = json_decode(file_get_contents(__DIR__ . '/manifest.json'), true);
                $manifest['start_url'] = $appurl . '/';
                $manifest['scope']     = $appurl . '/';
                foreach ($manifest['icons'] as &$icon) {
                    $icon['src'] = $appurl . '/icons/' . basename($icon['src']);
                }
                file_put_contents(__DIR__ . '/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

                $sw = file_get_contents(__DIR__ . '/sw.js');
                $sw = str_replace('/eval/', $appurl . '/', $sw);
                file_put_contents(__DIR__ . '/sw.js', $sw);
            }

            $success = true;
            $appLink = $appurl ?: '.';

            // Self-delete
            @unlink(__FILE__);

        } catch (PDOException $e) {
            $error = 'Database error: ' . $e->getMessage();
        } catch (Exception $e) {
            $error = 'Error: ' . $e->getMessage();
        }
    }
}

// Detect likely app URL
$proto   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host_hdr = $_SERVER['HTTP_HOST'] ?? 'localhost';
$dir     = rtrim(dirname($_SERVER['REQUEST_URI']), '/');
$guessUrl = $proto . '://' . $host_hdr . $dir;
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Scout Pro — Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#070c1a;color:#e8eaf6;font-family:Inter,-apple-system,sans-serif;font-size:15px;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .box{width:100%;max-width:480px}
  .logo{width:56px;height:56px;background:#4d65ff;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px;box-shadow:0 0 40px rgba(77,101,255,.4)}
  h1{text-align:center;font-size:24px;font-weight:800;margin-bottom:4px;letter-spacing:-.3px}
  .sub{text-align:center;color:#7b89b8;font-size:14px;margin-bottom:28px}
  .card{background:#10162c;border:1px solid #263060;border-radius:16px;padding:28px}
  label{display:block;color:#7b89b8;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
  input{background:#151d38;border:1px solid #263060;color:#e8eaf6;padding:9px 13px;border-radius:10px;font-size:14px;width:100%;outline:none;font-family:inherit;transition:border-color .15s}
  input:focus{border-color:#4d65ff;box-shadow:0 0 0 3px rgba(77,101,255,.15)}
  .field{margin-bottom:16px}
  .hint{color:#3d4d78;font-size:12px;margin-top:5px;line-height:1.5}
  .hint strong{color:#7b89b8}
  .divider{border:none;border-top:1px solid #1c2540;margin:20px 0}
  .btn{width:100%;background:#4d65ff;color:#fff;border:none;padding:11px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 12px rgba(77,101,255,.35);transition:background .15s}
  .btn:hover{background:#3a50e0}
  .error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#ef4444;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
  .success{text-align:center;padding:8px 0}
  .success .icon{font-size:52px;margin-bottom:16px}
  .success h2{color:#22c55e;font-size:22px;margin-bottom:8px}
  .success p{color:#7b89b8;font-size:14px;margin-bottom:20px;line-height:1.6}
  .launch{display:inline-block;background:#4d65ff;color:#fff;padding:11px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:15px}
  .section-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#3d4d78;margin-bottom:14px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">⚾</div>
  <h1>Scout Pro</h1>
  <p class="sub">One-time setup — takes about 30 seconds</p>

  <?php if ($success): ?>
  <div class="card success">
    <div class="icon">✅</div>
    <h2>Setup Complete!</h2>
    <p>Database created, tables installed, and config written.<br>The installer has deleted itself.</p>
    <a class="launch" href="<?= htmlspecialchars($appLink) ?>">Open Scout Pro →</a>
  </div>
  <?php else: ?>
  <div class="card">
    <?php if ($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <form method="POST">

      <p class="section-label">Database</p>
      <p class="hint" style="margin-bottom:16px">On cPanel, create the database and user in <strong>MySQL Databases</strong> first, then paste the details below.</p>

      <div class="field">
        <label>Database Host</label>
        <input name="db_host" value="localhost" placeholder="localhost" />
        <p class="hint">Usually <strong>localhost</strong> on shared hosting</p>
      </div>
      <div class="field">
        <label>Database Name</label>
        <input name="db_name" placeholder="cpanelusername_scoutpro" required />
        <p class="hint">cPanel prefixes with your username, e.g. <strong>john_scoutpro</strong></p>
      </div>
      <div class="field">
        <label>Database Username</label>
        <input name="db_user" placeholder="cpanelusername_scoutpro" required />
      </div>
      <div class="field">
        <label>Database Password</label>
        <input name="db_pass" type="password" placeholder="Database user password" />
      </div>

      <hr class="divider"/>
      <p class="section-label">App Settings</p>

      <div class="field">
        <label>Admin Password</label>
        <input name="admin_pass" type="password" placeholder="Set your admin password" value="admin123" />
        <p class="hint">Login as <strong>Administrator</strong> with this password</p>
      </div>
      <div class="field">
        <label>App URL (no trailing slash)</label>
        <input name="app_url" value="<?= htmlspecialchars($guessUrl) ?>" placeholder="https://yourdomain.com/eval" />
        <p class="hint">Used for PWA install links and offline caching</p>
      </div>

      <button type="submit" class="btn">Install Scout Pro →</button>
    </form>
  </div>
  <?php endif; ?>
</div>
</body>
</html>
