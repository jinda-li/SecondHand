-- Telegram alongside WeChat. A seller gives a WeChat ID, a Telegram username, or both
-- (wechat_id may now be empty); a buyer leaves one of the two when joining a queue.
-- Usernames are stored without the leading @.
ALTER TABLE sales ADD COLUMN telegram TEXT NOT NULL DEFAULT '';
ALTER TABLE queues ADD COLUMN buyer_telegram TEXT NOT NULL DEFAULT '';
-- Item name and details in the other language (Chinese <-> English), from the AI or machine
-- translation; the seller can correct them. alt_src is the "name\nnote" they were made from,
-- so an edit to the original knows the translation is stale.
ALTER TABLE items ADD COLUMN name_alt TEXT;
ALTER TABLE items ADD COLUMN note_alt TEXT;
ALTER TABLE items ADD COLUMN alt_src TEXT;
-- The same for the list: JSON {"title","location","rules":[],"src"}.
ALTER TABLE sales ADD COLUMN alt TEXT;
