-- Preorders for items that ship. The customer pays at checkout; the order is
-- held on the website (not sent to Printful) until the owner releases that
-- product's preorders, then it goes to Printful like any other order.

alter table products add column if not exists preorder boolean not null default false;
-- The date shown to customers ("Ships by ..."). Required while preorder is on.
alter table products add column if not exists preorder_ship_by date;

-- Kept with each order line, so later product edits never change what the customer was told.
alter table order_items add column if not exists is_preorder boolean not null default false;
alter table order_items add column if not exists preorder_ship_by date;
alter table order_items add column if not exists preorder_released_at timestamptz;

-- 'held': paid, waiting for the owner to release its preorder items.
alter table printful_orders drop constraint if exists printful_orders_state_check;
alter table printful_orders add constraint printful_orders_state_check
  check (state in ('held','queued','submitting','uncertain','draft','confirming','submitted','needs_attention','canceled','fulfilled'));
alter table printful_orders add column if not exists released_at timestamptz;
alter table printful_orders add column if not exists released_by text;
create index if not exists printful_orders_held_idx on printful_orders (created_at) where state = 'held';
