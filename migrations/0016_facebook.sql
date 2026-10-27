-- Facebook buy-and-sell groups, alongside WeChat and Telegram. A seller may give their Facebook
-- profile link (https://www.facebook.com/..., or m.me/...) as a third contact; a buyer joining a queue
-- may leave the name Facebook shows for them, or their profile link.
ALTER TABLE sales ADD COLUMN facebook TEXT NOT NULL DEFAULT '';
ALTER TABLE queues ADD COLUMN buyer_facebook TEXT NOT NULL DEFAULT '';
