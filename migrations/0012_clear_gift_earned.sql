-- Friend gift cards no longer show what the sender earned; drop the amounts already stored.
UPDATE keep_gifts SET earned = NULL;
