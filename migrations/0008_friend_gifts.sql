-- A gift can also be sent to a friend: the card carries the sender's name and what they made,
-- and the friend can claim it right away (no one-hour wait). The sender opening it does not claim it.
ALTER TABLE keep_gifts ADD COLUMN kind TEXT NOT NULL DEFAULT 'keep';
ALTER TABLE keep_gifts ADD COLUMN from_name TEXT;
ALTER TABLE keep_gifts ADD COLUMN earned TEXT;
