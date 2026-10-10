ALTER TABLE sales ADD COLUMN owner_sub TEXT;
ALTER TABLE sales ADD COLUMN owner_email TEXT;
CREATE INDEX idx_sales_owner ON sales (owner_sub);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  email TEXT,
  name TEXT,
  created_at INTEGER NOT NULL
);
