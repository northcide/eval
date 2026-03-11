<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
$demoCoach = requireAdmin();
if ($demoCoach['league_id'] === null) {
    jsonResponse(['error' => 'Superadmin cannot seed demo data directly. Log in as a league admin.'], 403);
}

$action = $_GET['action'] ?? '';
$db = getDB();

// ── Name pools ──────────────────────────────────────────────────────────────
$firstNames = [
    'Aiden','Alex','Andre','Anthony','Austin','Blake','Brady','Brandon','Brody','Caleb',
    'Cameron','Carlos','Carter','Chase','Christian','Cole','Connor','Cooper','Cruz','Damian',
    'Daniel','Dante','David','Derek','Diego','Dylan','Eli','Elijah','Ethan','Evan',
    'Finn','Gavin','Grant','Griffin','Hunter','Ian','Isaac','Jackson','Jake','Jason',
    'Jayden','Jordan','Jose','Julian','Justin','Kyle','Liam','Logan','Lucas','Luke',
    'Marcus','Mason','Matthew','Max','Miguel','Miles','Nathan','Noah','Nolan','Oliver',
    'Omar','Owen','Parker','Preston','Quinn','Remy','Riley','Roman','Ryan','Samuel',
    'Sebastian','Seth','Shane','Tanner','Thomas','Trevor','Tyler','Victor','Wesley','Wyatt',
    'Xavier','Zachary','Zane','Aaron','Adam','Adrian','Alexis','Angel','Bryce','Casey',
    'Colin','Dallas','Devin','Drew','Eric','Felix','George','Henry','Ivan','Jack'
];

$lastNames = [
    'Adams','Allen','Anderson','Baker','Barnes','Bell','Bennett','Brooks','Brown','Bryant',
    'Butler','Campbell','Carter','Clark','Collins','Cook','Cooper','Cox','Cruz','Davis',
    'Diaz','Edwards','Evans','Fisher','Flores','Foster','Garcia','Gomez','Gonzalez','Green',
    'Hall','Harris','Hayes','Henderson','Hill','Howard','Hughes','Jackson','James','Jenkins',
    'Johnson','Jones','Kelly','King','Lee','Lewis','Long','Lopez','Martin','Martinez',
    'Miller','Mitchell','Moore','Morgan','Morris','Nelson','Nguyen','Parker','Patel','Perez',
    'Perry','Peterson','Phillips','Powell','Price','Ramirez','Reed','Rivera','Roberts','Robinson',
    'Rodriguez','Rogers','Ross','Russell','Sanchez','Scott','Smith','Stewart','Sullivan','Taylor',
    'Thomas','Thompson','Torres','Turner','Walker','Ward','Watson','White','Williams','Wilson',
    'Wood','Wright','Young','Zimmerman','Banks','Bishop','Burns','Castro','Coleman','Dixon'
];

$coachFirstNames = ['Brian','Chris','Dan','Frank','Gary','Jason','Jeff','Kevin','Mark','Mike',
                    'Paul','Scott','Steve','Tim','Tom','Rich','Dave','Bob','Jim','Tony'];
$coachLastNames  = ['Andrews','Barrett','Crawford','Duncan','Fletcher','Graham','Hammond',
                    'Irving','Jensen','Lawson','Murray','Norris','Owens','Pierce','Quinn',
                    'Rhodes','Simmons','Tucker','Underwood','Vaughn'];

switch ($action) {

    // ── Seed divisions ──────────────────────────────────────────────────────
    case 'divisions':
        $demo = ['Majors', 'AAA', 'AA', 'Single-A'];
        $created = 0;
        foreach ($demo as $name) {
            $exists = $db->prepare("SELECT id FROM divisions WHERE name = ? AND league_id = ?");
            $exists->execute([$name, $demoCoach['league_id']]);
            if (!$exists->fetch()) {
                $db->prepare("INSERT INTO divisions (name, league_id) VALUES (?, ?)")->execute([$name, $demoCoach['league_id']]);
                $created++;
            }
        }
        jsonResponse(['created' => $created, 'message' => $created > 0
            ? "Created {$created} division(s)."
            : 'Demo divisions already exist.']);
        break;

    // ── Seed players — 100 per division ────────────────────────────────────
    case 'players':
        // Delete all existing players (and their evaluations) for this league
        $leagueId = $demoCoach['league_id'];
        $db->prepare("DELETE FROM evaluations WHERE player_id IN (SELECT p.id FROM players p JOIN divisions d ON d.id=p.division_id WHERE d.league_id=?)")->execute([$leagueId]);
        $db->prepare("DELETE FROM players WHERE division_id IN (SELECT id FROM divisions WHERE league_id=?)")->execute([$leagueId]);

        $divs = $db->prepare("SELECT id FROM divisions WHERE league_id=?");
        $divs->execute([$leagueId]);
        $divs = $divs->fetchAll();
        if (!$divs) jsonResponse(['error' => 'No divisions found. Create divisions first.'], 400);

        $total = 0;
        foreach ($divs as $div) {
            $used = [];
            $stmt = $db->prepare("INSERT INTO players (name, age, is_pitcher, is_catcher, division_id) VALUES (?,?,?,?,?)");
            for ($i = 0; $i < 100; $i++) {
                // Pick a unique name
                $attempts = 0;
                do {
                    $first = $firstNames[array_rand($firstNames)];
                    $last  = $lastNames[array_rand($lastNames)];
                    $name  = "$first $last";
                    $attempts++;
                } while (isset($used[$name]) && $attempts < 50);
                if (isset($used[$name])) $name .= ' ' . ($i + 1); // fallback suffix
                $used[$name] = true;

                $age = rand(8, 14);
                $roll = rand(1, 100);
                $isPitcher = ($roll <= 20) ? 1 : 0;
                $isCatcher = ($roll > 20 && $roll <= 30) ? 1 : 0;

                $stmt->execute([$name, $age, $isPitcher, $isCatcher, $div['id']]);
                $total++;
            }
        }
        jsonResponse(['created' => $total, 'message' => "Created {$total} players across " . count($divs) . " division(s)."]);
        break;

    // ── Seed coaches — 10 demo coaches ─────────────────────────────────────
    case 'coaches':
        $leagueId = $demoCoach['league_id'];
        // Delete all non-admin coaches in this league
        $db->prepare("DELETE FROM evaluations WHERE coach_id IN (SELECT id FROM coaches WHERE is_admin = 0 AND league_id = ?)")->execute([$leagueId]);
        $db->prepare("DELETE FROM coaches WHERE is_admin = 0 AND league_id = ?")->execute([$leagueId]);

        $hash = password_hash('coach123', PASSWORD_DEFAULT);
        $stmt = $db->prepare("INSERT INTO coaches (name, password, is_admin, league_id) VALUES (?, ?, 0, ?)");
        $used = [];
        $created = 0;
        while ($created < 10) {
            $name = $coachFirstNames[array_rand($coachFirstNames)] . ' ' . $coachLastNames[array_rand($coachLastNames)];
            if (isset($used[$name])) continue;
            $used[$name] = true;
            $stmt->execute([$name, $hash, $leagueId]);
            $created++;
        }
        jsonResponse(['created' => $created, 'message' => "Created {$created} coaches. Password for all: coach123"]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action'], 400);
}
