-- Set once a device says it tipped the developer; the tip bonus is granted only the first time.
ALTER TABLE ai_quota ADD COLUMN tipped INTEGER NOT NULL DEFAULT 0;
