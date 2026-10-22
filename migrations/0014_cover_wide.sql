-- A landscape (1200×630) card picture for links shared to Telegram, which shows such pictures
-- large under the message; the square cover_photo stays for WeChat cards.
ALTER TABLE sales ADD COLUMN cover_wide TEXT;
