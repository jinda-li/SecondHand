-- A list stays open to buyers for 30 days after its last renewal (create, renew, reopen);
-- after that it is paused until the seller taps 续期 on the management page.
-- Existing lists start their 30 days on the day this ships, so none pause at once.
ALTER TABLE sales ADD COLUMN renewed_at INTEGER NOT NULL DEFAULT 0;
UPDATE sales SET renewed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
