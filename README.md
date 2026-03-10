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

### Step 1 — Create the database

Log into MySQL and run the schema file:

```bash
mysql -u root -p < sql/schema.sql
```

Or from within MySQL:
```sql
SOURCE /path/to/scout-pro/sql/schema.sql;
```

### Step 2 — Configure the database connection

Edit **`api/config.php`** and update these four lines:

```php
define('DB_HOST', 'localhost');   // your MySQL host
define('DB_NAME', 'scout_pro');   // database name (created by schema.sql)
define('DB_USER', 'root');        // your MySQL username
define('DB_PASS', '');            // your MySQL password
```

### Step 3 — Deploy the files

Copy the entire `scout-pro/` folder into your web root:

```bash
cp -r scout-pro/ /var/www/html/scout-pro
```

### Step 4 — Open in browser

```
http://your-server/scout-pro/
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

## 🎯 Evaluation Flow

1. Admin creates **Divisions**, adds **Players** and **Coaches**
2. Admin starts an **Evaluation Session** for a division
3. Coaches log in → **Evaluate** tab shows the current player + skill
4. Each coach scores the player (1–10) and taps **Next Player**
5. All players complete one skill before advancing to the next
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
