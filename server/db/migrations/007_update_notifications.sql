-- Automatic product updates: saving an existing published digital product
-- with a new file releases it, and customers who downloaded an older
-- version get one notification per product and version. Notifications are
-- rows here (claimed by one worker at a time), so retries and concurrent
-- runs never send twice. Older releases are never notified retroactively.

-- How a release started: the owner's Save, or the earlier manual release.
alter table product_releases add column if not exists trigger text not null default 'manual';
-- An upload saved again with the same content as the current file is not released.
alter table product_file_uploads add column if not exists outcome text not null default '';

create table if not exists update_notifications (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references product_releases(id),
  product_id uuid not null references products(id),
  version_id uuid not null references product_versions(id),
  user_id text not null references "user"(id) on delete cascade,
  -- update:<customer>:<product>:<version>  at most one per customer, product and version
  dedupe_key text not null unique,
  status text not null default 'scheduled' check (status in ('scheduled','processing','held','sent','skipped','failed','canceled')),
  status_reason text not null default '',
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text not null default '',
  email_id uuid references emails(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists update_notifications_pending_idx on update_notifications(created_at) where status = 'scheduled';
create index if not exists update_notifications_release_idx on update_notifications(release_id);
create index if not exists update_notifications_product_idx on update_notifications(product_id, status);
