-- Scout Pro v2 Migration: Add multi-tenant league support
-- Run this on existing installations to upgrade from v1
-- MySQL-compatible (no IF NOT EXISTS on ALTER TABLE)

USE scout_pro;

-- Add leagues table
CREATE TABLE IF NOT EXISTS leagues (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create a default league for existing data
INSERT IGNORE INTO leagues (id, name) VALUES (1, 'Default League');

-- Add league_id to coaches, divisions, eval_sessions
-- Using stored procedures to safely add columns only if missing (MySQL-compatible)

DROP PROCEDURE IF EXISTS sp_add_column;
DELIMITER //
CREATE PROCEDURE sp_add_column(
    IN tbl VARCHAR(64),
    IN col VARCHAR(64),
    IN col_def TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = tbl
          AND COLUMN_NAME  = col
    ) THEN
        SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', col_def);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL sp_add_column('coaches',      'league_id', 'league_id INT NULL AFTER is_admin');
CALL sp_add_column('divisions',    'league_id', 'league_id INT NOT NULL DEFAULT 1 AFTER name');
CALL sp_add_column('eval_sessions','league_id', 'league_id INT NOT NULL DEFAULT 1 AFTER division_id');

DROP PROCEDURE IF EXISTS sp_add_column;

-- Superadmin stays NULL; assign all other coaches to default league
UPDATE coaches SET league_id = 1 WHERE league_id IS NULL AND (is_admin = 0 OR name != 'Administrator');

-- Add foreign key constraints (ignore error if already exists)
ALTER TABLE coaches       ADD CONSTRAINT fk_coaches_league  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE divisions     ADD CONSTRAINT fk_divisions_league FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE eval_sessions ADD CONSTRAINT fk_sessions_league  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;

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
    SELECT 'Fielding', 1         UNION ALL
    SELECT 'Pitching', 2         UNION ALL
    SELECT 'Hitting',  3
) s ON 1=1;
