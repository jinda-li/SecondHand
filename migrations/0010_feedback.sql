-- In-app feedback. page is the path only (never the query: manage links carry the admin key).
-- photos: JSON ids of screenshots, kept in the photos table with an empty sale_id so no item can use them.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  text TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_time ON feedback (created_at);
