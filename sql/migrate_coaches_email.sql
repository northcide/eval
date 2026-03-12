-- Migration: add email + league_id columns to coaches for auth compatibility
-- The coaches table in the original schema lacked these columns required by auth.php

ALTER TABLE coaches
  ADD COLUMN email      VARCHAR(255) NULL AFTER name,
  ADD COLUMN league_id  INT NULL DEFAULT NULL AFTER is_admin;

-- Generate email addresses from names for existing coaches
UPDATE coaches SET email = CONCAT(LOWER(REPLACE(name,' ','.')), '@local.dev')
WHERE email IS NULL;

ALTER TABLE coaches ADD UNIQUE KEY unique_email (email);
