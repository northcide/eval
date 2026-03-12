-- Migration: Add check-in system with bib number support
-- Run once on existing databases

ALTER TABLE eval_sessions
  ADD COLUMN bib_mode ENUM('blank','numbered') NOT NULL DEFAULT 'blank'
  AFTER active;

CREATE TABLE IF NOT EXISTS session_checkins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    session_id    INT NOT NULL,
    player_id     INT NOT NULL,
    bib_number    SMALLINT UNSIGNED NOT NULL,
    checked_in    TINYINT(1) NOT NULL DEFAULT 0,
    checked_in_at TIMESTAMP NULL,
    assigned_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_session_player (session_id, player_id),
    UNIQUE KEY unique_session_bib    (session_id, bib_number),
    FOREIGN KEY (session_id) REFERENCES eval_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id)  REFERENCES players(id)       ON DELETE CASCADE
);
