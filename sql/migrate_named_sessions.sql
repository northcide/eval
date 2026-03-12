-- Migration: named league-wide evaluation sessions
-- Run ONCE before deploying updated code

ALTER TABLE eval_sessions ADD COLUMN name VARCHAR(100) NOT NULL DEFAULT '' AFTER id;
ALTER TABLE eval_sessions MODIFY COLUMN division_id INT NULL;

-- Backfill names for existing rows
UPDATE eval_sessions s
  LEFT JOIN divisions d ON d.id = s.division_id
  SET s.name = CONCAT('Session ', s.id, IF(d.name IS NOT NULL, CONCAT(' — ', d.name), ''))
  WHERE s.name = '';
