# ⚾ Scout Pro — Baseball Evaluation System (LAMP Edition)

A PHP/MySQL web app for baseball league player evaluations.  
No Node.js, no build step — just drop it on a LAMP server.

---

## 📋 Requirements

- Apache 2.4+ (or nginx with PHP-FPM)
- PHP 8.0+ with PDO and PDO_MySQL extensions
- MySQL 5.7+ or MariaDB 10.4+

---

## 🚀 Installation

Two options: the **web installer** (recommended for cPanel/shared hosting) or **manual setup**.

---

### Option A — Web Installer (cPanel / shared hosting)

`setup.php` creates the database tables, writes `api/config.php`, and deletes itself when done.

**1. Create a MySQL database and user in cPanel**

In cPanel → **MySQL Databases**:
- Create a new database (e.g. `john_scoutpro`)
- Create a database user with a password
- Add the user to the database with **All Privileges**

**2. Upload the files**

Upload the entire project folder to your host via FTP or the cPanel File Manager (e.g. into `public_html/eval/`).

**3. Run the installer**

Visit in your browser:
```
https://yourdomain.com/eval/setup.php
```

Fill in your database host (usually `localhost`), name, username, password, and choose an admin password. Click **Install Scout Pro**.

The installer creates all tables, writes `api/config.php`, and deletes itself automatically.

**4. Open the app**
```
https://yourdomain.com/eval/
```

Log in as `Administrator` with the password you set during setup.

---

### Option B — Manual Setup

**1. Create the database**

```bash
mysql -u root -p < sql/schema.sql
```

**2. Configure the connection**

Edit `api/config.php`:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'scout_pro');
define('DB_USER', 'root');
define('DB_PASS', '');
```

**3. Deploy**

```bash
cp -r eval/ /var/www/html/eval
```

**4. Open in browser**
```
http://your-server/eval/
```

---

## 🔐 Default Login

| Role | Name | Password |
|------|------|----------|
| Administrator | `Administrator` | `admin123` |

> **Important:** Change the admin password after first login by updating the database directly:
> ```sql
> UPDATE coaches SET password = '$2y$10$...' WHERE id = 1;
> ```
> Generate a hash with PHP: `echo password_hash('your_new_password', PASSWORD_DEFAULT);`

---

## 📁 File Structure

```
scout-pro/
├── index.html          ← Single-page app shell
├── css/
│   └── app.css         ← All styles
├── js/
│   └── app.js          ← All frontend logic
├── api/
│   ├── config.php      ← DB config + shared helpers ⚠️ edit this
│   ├── auth.php        ← Login / logout / session
│   ├── divisions.php   ← Division CRUD
│   ├── players.php     ← Player CRUD + CSV import
│   ├── coaches.php     ← Coach management
│   ├── sessions.php    ← Evaluation session control
│   └── evaluations.php ← Score submission + results
└── sql/
    └── schema.sql      ← Database setup script
```

---

## 📥 CSV Import Format

One player per line:

```
Name, Age, Position, Division
John Smith, 12, Pitcher, Majors
Jane Doe, 11, Player, AAA
Bob Jones, 10, Catcher, Majors
```

- **Position** options: `Player`, `Pitcher`, `Catcher`
- **Division** name must match exactly what's in the Divisions tab

---

## 📱 Installing as a PWA (Home Screen App)

Scout Pro is a Progressive Web App — coaches and admins can install it to their home screen for a full-screen, app-like experience with offline support.

### iPhone / iPad (Safari)

1. Open the app URL in **Safari** (must be Safari — Chrome on iOS cannot install PWAs)
2. Tap the **Share** button (box with arrow pointing up) in the toolbar
3. Scroll down and tap **Add to Home Screen**
4. Give it a name (e.g. "Scout Pro") and tap **Add**

The app icon will appear on your home screen. Launch it from there for full-screen mode.

### Android (Chrome)

1. Open the app URL in **Chrome**
2. Tap the **three-dot menu** (⋮) in the top-right corner
3. Tap **Add to Home screen** (or Chrome may show an install banner automatically)
4. Tap **Add**

On Android, Chrome may also display an **"Install app"** prompt in the address bar — tap it for a one-tap install.

---

## 📡 Offline / Poor Connectivity Support

Scout Pro works in areas with no or unreliable internet. Here's how it handles connectivity:

### How it works

- **First use:** Open the app and navigate to the Evaluate tab while connected. The app automatically downloads and caches the player list, session data, and your previous scores to the device.
- **Offline or poor signal:** The app reads from the local cache. You can score players normally — evaluations are saved to the device.
- **Reconnected:** Queued scores upload to the server automatically. On Android, this can happen in the background even if the app is closed.

### What you'll see

| Indicator | Meaning |
|-----------|---------|
| **"Offline"** badge in the header | Device has no network connection |
| **"Sync (N pending)"** button | N scores saved locally, not yet uploaded |
| **"You are offline…"** banner on Evaluate tab | Scoring in offline mode |

Tap **Sync** at any time while connected to manually trigger an upload.

### Platform notes

- **iOS (Safari):** Upload triggers automatically when the device reconnects. Keep the app open when returning to connectivity.
- **Android (Chrome):** Uses the Background Sync API — scores can upload even if the browser is in the background or the screen is off.
- **Data safety:** Scores are never lost. If a submission fails mid-upload, the remaining items stay in the queue and retry on next sync.

### Recommended field workflow

1. **Before leaving WiFi:** Open the app → go to Evaluate → let it load the player list
2. **At the field:** Evaluate normally — the "Offline" badge will appear if connectivity drops
3. **Back on WiFi:** The sync happens automatically; verify scores uploaded via the Results tab

---

## 🎯 Evaluation Flow

1. Admin creates **Divisions**, adds **Players** and **Coaches**
2. Admin starts an **Evaluation Session** for a division
3. Coaches log in → **Evaluate** tab shows the current player + skill
4. Each coach scores the player (1–10) and taps **Next Player**
5. Coaches can freely switch between skills using the skill steps at the top
6. **Results** tab: admin sees all coaches' scores; coaches see only their own

---

## 🔒 Security Notes

- Passwords are hashed with PHP's `password_hash()` (bcrypt)
- All DB queries use PDO prepared statements (SQL injection safe)
- Session-based authentication with server-side checks on every API call
- For production, consider placing `api/config.php` above the web root

---

## 🛠 Troubleshooting

**Blank page / spinner stuck**  
→ Check browser console for errors. Verify `api/config.php` DB credentials.

**"Database connection failed"**  
→ Confirm MySQL is running and credentials in `config.php` are correct.

**Session not persisting**  
→ Ensure PHP sessions are enabled and your server has write access to the session directory.

**Import not working**  
→ Make sure division names in your CSV match exactly (case-insensitive).
