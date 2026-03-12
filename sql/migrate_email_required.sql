-- Migration: email as required login credential + coaches_child flag
-- Run ONCE before deploying updated code

-- Backfill superadmin email
UPDATE coaches SET email = 'admin@local.dev'
WHERE name = 'Administrator' AND is_admin = 1 AND league_id IS NULL AND email IS NULL;

-- Backfill any other coaches missing email
UPDATE coaches SET email = CONCAT('coach-', id, '@no-email.local')
WHERE email IS NULL;

-- Make email NOT NULL
ALTER TABLE coaches MODIFY COLUMN email VARCHAR(255) NOT NULL;

-- Add coaches_child column to players
ALTER TABLE players ADD COLUMN is_coaches_child TINYINT(1) DEFAULT 0;
