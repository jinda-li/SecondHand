-- Per-device AI photo-recognition quota. client_id is the browser's random device token.
CREATE TABLE ai_quota (
  client_id TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  unlimited INTEGER NOT NULL DEFAULT 0,
  survey_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Global daily cap so a bug or abuse can't run up the AI bill.
CREATE TABLE ai_daily (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
