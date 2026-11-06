-- WhatsApp groups, alongside WeChat, Telegram and Facebook. A seller may give a WhatsApp number as a
-- contact; a buyer joining a queue may leave theirs. Numbers are stored in international form as
-- digits only, without the + (what https://wa.me/<number> takes).
ALTER TABLE sales ADD COLUMN whatsapp TEXT NOT NULL DEFAULT '';
ALTER TABLE queues ADD COLUMN buyer_whatsapp TEXT NOT NULL DEFAULT '';
