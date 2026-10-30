-- Nurse Love Company store schema.
-- Better Auth owns the "user", "session", "account" and "verification" tables
-- (created by server/db/migrate.ts). Everything below belongs to the store.

create extension if not exists pgcrypto;

-- Settings ------------------------------------------------------------------
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Customers -----------------------------------------------------------------
create table customer_profiles (
  user_id text primary key references "user"(id) on delete cascade,
  order_updates boolean not null default true,
  product_updates boolean not null default true,
  marketing boolean not null default false,
  admin_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  name text not null,
  line1 text not null,
  line2 text not null default '',
  city text not null,
  region text not null default '',
  postal_code text not null,
  country text not null default 'US',
  phone text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on addresses(user_id);

-- Products ------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 160),
  category text not null check (category in ('nurse-inserts','np-inserts','apparel','accessories','pens','other')),
  collection text not null default '',
  type text not null check (type in ('digital','physical')),
  short_description text not null default '',
  description jsonb not null default '{"type":"doc","content":[]}',
  price_cents integer check (price_cents >= 0),
  sale_price_cents integer check (sale_price_cents >= 0),
  currency text not null default 'usd',
  featured boolean not null default false,
  active boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published')),
  archived_at timestamptz,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  -- digital
  page_count integer check (page_count > 0),
  page_size text,
  orientation text check (orientation in ('portrait','landscape')),
  file_format text,
  usage_attributes text[] not null default '{}',
  app_compatibility text[] not null default '{}',
  show_binder_notice boolean not null default false,
  current_version_id uuid,
  -- physical
  sku text unique,
  weight_grams integer check (weight_grams >= 0),
  shipping_info text not null default '',
  inventory_quantity integer not null default 0,
  low_stock_threshold integer not null default 3,
  out_of_stock_behavior text not null default 'show_sold_out' check (out_of_stock_behavior in ('hide','show_sold_out','allow_backorder')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (sale_price_cents is null or (price_cents is not null and sale_price_cents < price_cents))
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  title text not null,
  options jsonb not null default '{}',
  sku text unique,
  price_cents integer check (price_cents >= 0),
  inventory_quantity integer not null default 0,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index product_variants_product_idx on product_variants(product_id);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  kind text not null default 'gallery' check (kind in ('gallery','sample')),
  storage_key text not null,
  content_type text not null,
  width integer,
  height integer,
  alt text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on product_images(product_id, kind, sort_order);

-- Released digital files. Rows are immutable once inserted.
create table product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  version_number integer not null,
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0),
  sha256 text not null,
  notes text not null default '',
  released_at timestamptz not null default now(),
  released_by text,
  unique (product_id, version_number)
);
alter table products add constraint products_current_version_fk foreign key (current_version_id) references product_versions(id);

-- Uploaded but not yet released product files (staging area for releases).
create table product_file_uploads (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  file_size bigint not null,
  sha256 text not null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  released_version_id uuid references product_versions(id)
);

create table product_releases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  version_id uuid not null unique references product_versions(id),
  idempotency_key text not null unique,
  notify boolean not null default false,
  affected_count integer not null default 0,
  granted_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;
create trigger product_versions_immutable before update or delete on product_versions
  for each row execute function forbid_change();

-- Orders --------------------------------------------------------------------
create sequence order_number_seq start 10001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('NLC-' || nextval('order_number_seq')),
  user_id text references "user"(id) on delete set null,
  email text not null,
  customer_name text not null default '',
  status text not null default 'pending' check (status in ('pending','paid','failed','canceled','refunded','partially_refunded','disputed')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled','partially_fulfilled','fulfilled','not_required')),
  currency text not null default 'usd',
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  shipping_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  fee_cents integer,
  refunded_cents integer not null default 0,
  billing_details jsonb not null default '{}',
  shipping_address jsonb,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz not null default now()
);
create index orders_user_idx on orders(user_id, created_at desc);
create index orders_created_idx on orders(created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  variant_id uuid references product_variants(id) on delete restrict,
  product_type text not null check (product_type in ('digital','physical')),
  title_snapshot text not null,
  variant_snapshot text not null default '',
  sku_snapshot text not null default '',
  category_snapshot text not null default '',
  unit_price_cents integer not null,
  quantity integer not null check (quantity > 0),
  discount_cents integer not null default 0,
  line_total_cents integer not null,
  refunded_quantity integer not null default 0,
  version_id_at_purchase uuid references product_versions(id),
  -- Digital products default to quantity one until the business decides otherwise.
  check (product_type = 'physical' or quantity = 1)
);
create index order_items_order_idx on order_items(order_id);
create index order_items_product_idx on order_items(product_id);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null default '',
  stripe_refund_id text unique,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','canceled')),
  -- Which lines and quantities this refund covers: [{"order_item_id": "...", "quantity": 1}]
  items jsonb not null default '[]',
  restock boolean not null default false,
  failure_reason text not null default '',
  idempotency_key text unique,
  created_by text,
  created_at timestamptz not null default now()
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  carrier text not null default '',
  tracking_number text not null default '',
  tracking_url text not null default '',
  status text not null default 'shipped' check (status in ('label_created','shipped','in_transit','delivered','exception')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table order_updates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  message text not null,
  customer_visible boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  body text not null,
  author_id text,
  author_email text,
  created_at timestamptz not null default now()
);

-- Verified payment provider events, stored once (idempotency).
create table payment_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Download entitlements -----------------------------------------------------
create table entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  product_id uuid not null references products(id),
  order_item_id uuid not null references order_items(id),
  version_id uuid not null references product_versions(id),
  source text not null check (source in ('purchase','update','admin_replacement')),
  status text not null default 'available' check (status in ('available','redeemed','superseded','revoked')),
  release_id uuid references product_releases(id),
  reason text not null default '',
  granted_by text,
  granted_at timestamptz not null default now(),
  redeemed_at timestamptz,
  status_changed_at timestamptz not null default now(),
  check (source <> 'admin_replacement' or length(reason) > 0)
);
-- Never more than one unredeemed download per purchased item: no stacking.
create unique index entitlements_one_available on entitlements(order_item_id) where status = 'available';
-- A purchase or an update grants at most one entitlement per version, even if retried.
create unique index entitlements_once_per_version on entitlements(order_item_id, version_id) where source in ('purchase','update');
create index entitlements_user_idx on entitlements(user_id);

create table download_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  entitlement_id uuid not null references entitlements(id),
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text,
  user_agent text
);

create table download_events (
  id bigserial primary key,
  entitlement_id uuid references entitlements(id),
  user_id text,
  version_id uuid,
  event text not null,
  detail text not null default '',
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index download_events_ent_idx on download_events(entitlement_id);

create table download_problem_reports (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references entitlements(id),
  user_id text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','resolved','declined')),
  resolution_note text not null default '',
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  order_id uuid references orders(id),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);

-- Email ---------------------------------------------------------------------
create table email_templates (
  type text primary key,
  subject text not null,
  heading text not null,
  body text not null,
  button_label text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

create table emails (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  to_email text not null,
  subject text not null,
  html text not null,
  text_body text not null default '',
  related_user_id text,
  related_order_id uuid references orders(id),
  related_release_id uuid references product_releases(id),
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','delivery_delayed','bounced','complained','failed','suppressed','not_configured')),
  resend_id text unique,
  idempotency_key text not null unique,
  resent_from_id uuid references emails(id),
  resent_by text,
  attempts integer not null default 0,
  failure_reason text not null default '',
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  failed_at timestamptz,
  last_event_at timestamptz,
  is_demo boolean not null default false
);
create index emails_requested_idx on emails(requested_at desc);
create index emails_to_idx on emails(lower(to_email));

create table email_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  email_id uuid references emails(id),
  resend_id text,
  type text not null,
  payload jsonb not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);

create table email_suppressions (
  email text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Tutorials -----------------------------------------------------------------
create table tutorials (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  category text not null check (category in ('np-binder','nurse-binder','printing-assembly','digital-files')),
  summary text not null default '',
  instructions jsonb not null default '{"type":"doc","content":[]}',
  transcript text not null default '',
  status text not null default 'draft' check (status in ('draft','published','unpublished','archived')),
  featured boolean not null default false,
  display_order integer not null default 0,
  thumbnail_key text,
  thumbnail_type text,
  video_provider text check (video_provider in ('mux','local','embed')),
  video_status text not null default 'none' check (video_status in ('none','uploading','processing','ready','errored')),
  video_error text not null default '',
  duration_seconds numeric,
  video_key text,
  poster_key text,
  mux_upload_id text,
  mux_asset_id text,
  mux_public_playback_id text,
  mux_signed_playback_id text,
  embed_url text,
  is_placeholder boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz
);

create table tutorial_captions (
  id uuid primary key default gen_random_uuid(),
  tutorial_id uuid not null references tutorials(id) on delete cascade,
  label text not null,
  srclang text not null,
  vtt text not null,
  unique (tutorial_id, srclang)
);

create table tutorial_products (
  tutorial_id uuid not null references tutorials(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  primary key (tutorial_id, product_id)
);

create table video_uploads (
  id uuid primary key default gen_random_uuid(),
  tutorial_id uuid not null references tutorials(id) on delete cascade,
  provider text not null,
  status text not null default 'created' check (status in ('created','uploading','uploaded','processing','ready','failed')),
  file_name text not null default '',
  content_type text not null default '',
  bytes bigint,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit ---------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  actor_id text,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  data jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log(created_at desc);
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function forbid_change();
