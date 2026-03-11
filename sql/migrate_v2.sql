-- Scout Pro v2 Migration: Add multi-tenant league support
-- Run this on existing installations to upgrade from v1

USE scout_pro;

-- Add leagues table
CREATE TABLE IF NOT EXISTS leagues (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create a default league for existing data
INSERT IGNORE INTO leagues (id, name) VALUES (1, 'Default League');

-- Add league_id to coaches (NULL = superadmin)
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS league_id INT NULL AFTER is_admin;
ALTER TABLE coaches ADD CONSTRAINT IF NOT EXISTS fk_coaches_league FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

-- Superadmin stays NULL; assign all other coaches to default league
UPDATE coaches SET league_id = 1 WHERE is_admin = 0 OR (is_admin = 1 AND name != 'Administrator');

-- Add league_id to divisions
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS league_id INT NOT NULL DEFAULT 1 AFTER name;
ALTER TABLE divisions ADD CONSTRAINT IF NOT EXISTS fk_divisions_league FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

-- Add league_id to eval_sessions
ALTER TABLE eval_sessions ADD COLUMN IF NOT EXISTS league_id INT NOT NULL DEFAULT 1 AFTER division_id;
ALTER TABLE eval_sessions ADD CONSTRAINT IF NOT EXISTS fk_sessions_league FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

-- Backfill sessions league_id from their division
UPDATE eval_sessions s JOIN divisions d ON d.id = s.division_id SET s.league_id = d.league_id;

-- Add skills table
CREATE TABLE IF NOT EXISTS skills (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    league_id  INT NOT NULL,
    name       VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Insert default skills for all existing leagues
INSERT IGNORE INTO skills (league_id, name, sort_order)
SELECT l.id, s.name, s.ord
FROM leagues l
JOIN (
    SELECT 'Running' as name, 0 as ord UNION ALL
    SELECT 'Fielding', 1 UNION ALL
    SELECT 'Pitching', 2 UNION ALL
    SELECT 'Hitting', 3
) s ON 1=1;
