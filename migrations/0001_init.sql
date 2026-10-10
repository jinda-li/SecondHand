CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  admin_key TEXT NOT NULL,
  title TEXT NOT NULL,
  wechat_id TEXT NOT NULL,
  location TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  rules TEXT NOT NULL DEFAULT '[]',
  leave_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  next_no INTEGER NOT NULL DEFAULT 1,
  cover_photo TEXT,
  seller_active_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  no INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  condition TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'available',
  status_checked_at INTEGER NOT NULL,
  status_changed_at INTEGER NOT NULL,
  price_changed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (sale_id, no)
);
CREATE INDEX idx_items_sale ON items (sale_id, status, no);

CREATE TABLE queues (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  buyer_token TEXT,
  nickname TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  added_by TEXT NOT NULL DEFAULT 'buyer',
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX idx_queues_item ON queues (item_id, status, seq);
CREATE INDEX idx_queues_buyer ON queues (buyer_token, status);
CREATE INDEX idx_queues_sale ON queues (sale_id, status);
CREATE UNIQUE INDEX uq_queues_waiting ON queues (item_id, buyer_token)
  WHERE status = 'waiting' AND buyer_token IS NOT NULL;

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  full BLOB NOT NULL,
  thumb BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_photos_sale ON photos (sale_id);
