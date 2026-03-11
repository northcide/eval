-- Scout Pro v3 Migration: Email login + multi-league coach support

DROP PROCEDURE IF EXISTS sp_v3_migrate;
DELIMITER //
CREATE PROCEDURE sp_v3_migrate()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coaches' AND COLUMN_NAME = 'email'
    ) THEN
        ALTER TABLE coaches ADD COLUMN email VARCHAR(255) NULL AFTER name;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coaches' AND INDEX_NAME = 'unique_email'
    ) THEN
        ALTER TABLE coaches ADD UNIQUE KEY unique_email (email);
    END IF;
END //
DELIMITER ;
CALL sp_v3_migrate();
DROP PROCEDURE IF EXISTS sp_v3_migrate;

CREATE TABLE IF NOT EXISTS coach_leagues (
    coach_id  INT NOT NULL,
    league_id INT NOT NULL,
    is_admin  TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (coach_id, league_id),
    FOREIGN KEY (coach_id)  REFERENCES coaches(id) ON DELETE CASCADE,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);
