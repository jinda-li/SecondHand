-- City from Cloudflare's IP geolocation at publish time, for the "同城" feed.
ALTER TABLE sales ADD COLUMN city TEXT;
CREATE INDEX idx_sales_city ON sales (city, public_nearby, status);
