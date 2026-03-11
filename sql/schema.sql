-- Scout Pro Baseball Evaluation System
-- Run this file once to set up the database

CREATE DATABASE IF NOT EXISTS scout_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE scout_pro;

-- Leagues
CREATE TABLE IF NOT EXISTS leagues (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Coaches / Admins
CREATE TABLE IF NOT EXISTS coaches (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    password   VARCHAR(255) NOT NULL,
    is_admin   TINYINT(1) DEFAULT 0,
    league_id  INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_name_per_league (name, league_id),
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Divisions
CREATE TABLE IF NOT EXISTS divisions (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    name      VARCHAR(100) NOT NULL,
    league_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Skills (per league, configurable)
CREATE TABLE IF NOT EXISTS skills (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    league_id  INT NOT NULL,
    name       VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Players
CREATE TABLE IF NOT EXISTS players (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    age         INT,
    is_pitcher  TINYINT(1) DEFAULT 0,
    is_catcher  TINYINT(1) DEFAULT 0,
    division_id INT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL
);

-- Evaluation Sessions
CREATE TABLE IF NOT EXISTS eval_sessions (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    division_id         INT NOT NULL,
    league_id           INT NOT NULL,
    current_skill_index INT DEFAULT 0,
    current_player_index INT DEFAULT 0,
    active              TINYINT(1) DEFAULT 1,
    started_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at            TIMESTAMP NULL,
    FOREIGN KEY (division_id) REFERENCES divisions(id),
    FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Evaluations (individual scores)
CREATE TABLE IF NOT EXISTS evaluations (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    session_id  INT NOT NULL,
    player_id   INT NOT NULL,
    coach_id    INT NOT NULL,
    skill_index INT NOT NULL,
    skill_name  VARCHAR(50) NOT NULL,
    score       INT NOT NULL CHECK (score >= 1 AND score <= 10),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_eval (session_id, player_id, coach_id, skill_index),
    FOREIGN KEY (session_id) REFERENCES eval_sessions(id),
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (coach_id) REFERENCES coaches(id)
);

-- Default superadmin account (password: admin123)
INSERT INTO coaches (name, password, is_admin, league_id)
VALUES ('Administrator', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, NULL)
ON DUPLICATE KEY UPDATE id=id;
