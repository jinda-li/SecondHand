-- "催更" taps when AI recognition is unavailable; one row per device per day.
CREATE TABLE ai_nudges (
  client_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, day)
);
