-- Buyer WeChat ID, required when joining a queue, so the seller can reach a buyer who never adds them.
-- Replaces the queue note (留言), which the seller had no way to answer. Empty for seller-added and older rows.
ALTER TABLE queues ADD COLUMN buyer_wechat TEXT NOT NULL DEFAULT '';
