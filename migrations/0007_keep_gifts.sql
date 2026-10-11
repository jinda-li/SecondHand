-- AI tries stored in a saved /keep?gift=<code> link: created when a buyer saves the page,
-- moved onto whichever device opens the link later, once.
CREATE TABLE keep_gifts (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_ip TEXT,
  redeemed_at INTEGER,
  redeemed_by TEXT
);
CREATE INDEX keep_gifts_created_by ON keep_gifts (created_by, created_at);
CREATE INDEX keep_gifts_created_ip ON keep_gifts (created_ip, created_at);
CREATE INDEX keep_gifts_redeemed_by ON keep_gifts (redeemed_by);
