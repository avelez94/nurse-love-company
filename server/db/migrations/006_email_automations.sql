-- Email automations: download reminders and review requests, plus the
-- shipment details they depend on (which items each shipment holds, and a
-- confirmed delivery time with its source). All three automations start
-- switched off. Times are timestamptz (UTC).

create table if not exists email_automations (
  kind text primary key check (kind in ('download_reminder','digital_review','physical_review')),
  enabled boolean not null default false,
  -- Days after the starting event: payment for digital, confirmed delivery for physical.
  delay_days integer not null check (delay_days between 1 and 90),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into email_automations (kind, delay_days) values
  ('download_reminder', 3), ('digital_review', 7), ('physical_review', 14)
on conflict (kind) do nothing;

-- One row per purchased item and automation. The dedupe key makes repeated
-- payment or delivery events, retries and overlapping jobs harmless:
--   download_reminder:<order item>   at most one reminder per purchased item
--   review:<customer>:<product>      at most one review request per customer and product
create table if not exists email_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('download_reminder','digital_review','physical_review')),
  dedupe_key text not null unique,
  status text not null default 'scheduled' check (status in ('scheduled','held','processing','sent','skipped','failed','canceled')),
  -- Why a request is held: waiting for confirmed delivery, the automation is
  -- switched off, or a known delivery problem.
  hold_reason text not null default '' check (hold_reason in ('','awaiting_delivery','automation_off','delivery_problem')),
  status_reason text not null default '',
  user_id text references "user"(id) on delete cascade,
  order_id uuid not null references orders(id),
  order_item_id uuid not null references order_items(id),
  product_id uuid not null references products(id),
  shipment_id uuid references shipments(id),
  -- The confirmed payment or delivery time the delay counts from.
  start_at timestamptz,
  due_at timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text not null default '',
  email_id uuid references emails(id),
  sent_at timestamptz,
  canceled_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_jobs_due_idx on email_jobs(due_at) where status = 'scheduled';
create index if not exists email_jobs_order_idx on email_jobs(order_id);
create index if not exists email_jobs_kind_idx on email_jobs(kind, status, created_at desc);

-- Which items (and how many) each shipment holds, for split shipments.
-- Shipments created before this existed cover every physical item of their order.
create table if not exists shipment_items (
  shipment_id uuid not null references shipments(id) on delete cascade,
  order_item_id uuid not null references order_items(id),
  quantity integer not null check (quantity > 0),
  primary key (shipment_id, order_item_id)
);

-- Confirmed delivery: where it came from (carrier, printful, admin) and why
-- (an admin must give a reason). "Shipped" or an estimated date never counts.
alter table shipments add column if not exists delivery_source text not null default '';
alter table shipments add column if not exists delivery_note text not null default '';
alter table shipments add column if not exists problem text not null default '';
alter table shipments add column if not exists status_at timestamptz;
alter table shipments add column if not exists updated_at timestamptz not null default now();

-- Tracking events from a future Printful or carrier connection, stored once.
create table if not exists shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id),
  source text not null,
  external_event_id text not null,
  status text not null,
  occurred_at timestamptz not null,
  detail text not null default '',
  outcome text not null default '',
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  unique (source, external_event_id)
);

-- Separate opt outs. Receipts and account security emails are not affected.
alter table customer_profiles add column if not exists download_reminders boolean not null default true;
alter table customer_profiles add column if not exists review_requests boolean not null default true;
