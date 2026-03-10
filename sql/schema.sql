-- Scout Pro Baseball Evaluation System
-- Run this file once to set up the database

CREATE DATABASE IF NOT EXISTS scout_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE scout_pro;

-- Divisions
CREATE TABLE IF NOT EXISTS divisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Coaches / Admins
CREATE TABLE IF NOT EXISTS coaches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Players
CREATE TABLE IF NOT EXISTS players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT,
    position ENUM('Player','Pitcher','Catcher') DEFAULT 'Player',
    division_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL
);

-- Evaluation Sessions
CREATE TABLE IF NOT EXISTS eval_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    division_id INT NOT NULL,
    current_skill_index INT DEFAULT 0,
    current_player_index INT DEFAULT 0,
    active TINYINT(1) DEFAULT 1,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    FOREIGN KEY (division_id) REFERENCES divisions(id)
);

-- Evaluations (individual scores)
CREATE TABLE IF NOT EXISTS evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    player_id INT NOT NULL,
    coach_id INT NOT NULL,
    skill_index INT NOT NULL,
    skill_name VARCHAR(50) NOT NULL,
    score INT NOT NULL CHECK (score >= 1 AND score <= 10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_eval (session_id, player_id, coach_id, skill_index),
    FOREIGN KEY (session_id) REFERENCES eval_sessions(id),
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (coach_id) REFERENCES coaches(id)
);

-- Default admin account (password: admin123)
INSERT INTO coaches (name, password, is_admin)
VALUES ('Administrator', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1)
ON DUPLICATE KEY UPDATE id=id;
