-- Stable keys for labeled demo orders, so loading demo content twice never
-- creates duplicates. Real orders leave this empty.
alter table orders add column if not exists demo_key text;
create unique index if not exists orders_demo_key_unique on orders(demo_key) where demo_key is not null;
alter table orders drop constraint if exists orders_demo_key_only_for_demo;
alter table orders add constraint orders_demo_key_only_for_demo check (demo_key is null or is_demo);
