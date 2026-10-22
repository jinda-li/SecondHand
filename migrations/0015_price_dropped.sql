-- When the seller last lowered the price: buyers' default order brings the item back up
-- and marks it. price_changed_at also counts raises, so it can't tell.
ALTER TABLE items ADD COLUMN price_dropped_at INTEGER;
