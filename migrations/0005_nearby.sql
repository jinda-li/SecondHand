-- Opt-in public discovery: a list can appear in "附近的二手".
-- lat/lng are rounded to 2 decimals (~1 km) before storing; never a precise address.
ALTER TABLE sales ADD COLUMN public_nearby INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN lat REAL;
ALTER TABLE sales ADD COLUMN lng REAL;
CREATE INDEX idx_sales_nearby ON sales (public_nearby, status, lat, lng);
