-- Drop tables in reverse order (to handle foreign key dependencies)
DROP TABLE IF EXISTS job;
DROP TABLE IF EXISTS turn;
DROP TABLE IF EXISTS story_entry;  
DROP TABLE IF EXISTS story_writer;
DROP TABLE IF EXISTS story;

-- initial schema (story, story_writer, turn, job)
CREATE TABLE IF NOT EXISTS story (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  URL VARCHAR(255),
  status TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  quick_mode TINYINT(1) DEFAULT 0,
  turn_length_hours INT DEFAULT 24,
  reminder_b4_timeout_hours INT DEFAULT 12,
  next_writer_id BIGINT NULL,
  FOREIGN KEY (next_writer_id) REFERENCES story_writer(id) ON DELETE SET NULL 
);

CREATE TABLE IF NOT EXISTS story_writer (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  story_id BIGINT NOT NULL,
  FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  display_name VARCHAR(255),
  pen_name VARCHAR(255),
  status TINYINT(1) DEFAULT 1,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  UNIQUE KEY (story_id, user_id)
);

CREATE TABLE story_entry (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  turn_id BIGINT NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turn(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  order_in_turn INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_turn_order (turn_id, order_in_turn)
);

CREATE TABLE IF NOT EXISTS turn (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  story_writer_id BIGINT NOT NULL,
  FOREIGN KEY (story_writer_id) REFERENCES story_writer(id) ON DELETE CASCADE,
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  status TINYINT(1) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(50) NOT NULL,
  payload JSON,
  run_at TIMESTAMP,
  attempts INT DEFAULT 0,
  status TINYINT(1) DEFAULT 0
);
