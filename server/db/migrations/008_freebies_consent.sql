-- Freebie products and email list consent.
-- A freebie is a published digital product the owner put in the Freebie
-- Corner at $0. Customers claim it through a short checkout that records a
-- real $0 order, kept apart from paid sales. Freebies are offered in
-- exchange for joining the email list; that consent is recorded with its
-- exact wording and history, separately from order emails.

alter table products add column if not exists is_freebie boolean not null default false;
alter table order_items add column if not exists is_freebie boolean not null default false;
-- An order made only of freebies: a free claim, not a paid purchase.
alter table orders add column if not exists is_free_claim boolean not null default false;
-- Email list signup chosen at checkout; applied when the order completes.
alter table orders add column if not exists marketing_request jsonb;
-- Future setting: download reminders and review requests for free claims (off).
alter table email_automations add column if not exists include_freebies boolean not null default false;

-- One row per email address on the marketing list (current state).
create table if not exists marketing_contacts (
  email text primary key,
  user_id text references "user"(id) on delete set null,
  status text not null check (status in ('subscribed','unsubscribed')),
  wording_version text not null default '',
  source text not null default '',
  subscribed_at timestamptz,
  unsubscribed_at timestamptz,
  -- Copy to the mailing list provider: pending until sent, never dropped.
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','failed','not_configured','skipped')),
  sync_error text not null default '',
  sync_attempts integer not null default 0,
  synced_at timestamptz,
  -- One copy in flight per contact; a change made meanwhile is sent again after it.
  sync_claimed_at timestamptz,
  change_seq bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists marketing_contacts_user_idx on marketing_contacts(user_id);
create index if not exists marketing_contacts_sync_idx on marketing_contacts(sync_status) where sync_status in ('pending','failed');

-- Every signup and unsubscribe, with the exact wording shown. Never changed.
create table if not exists marketing_consent_events (
  id bigserial primary key,
  email text not null,
  user_id text,
  action text not null check (action in ('subscribe','unsubscribe')),
  source text not null,
  wording_version text not null default '',
  wording text not null default '',
  order_id uuid references orders(id),
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_consent_events_email_idx on marketing_consent_events(email, created_at);
drop trigger if exists marketing_consent_events_immutable on marketing_consent_events;
create trigger marketing_consent_events_immutable before update or delete on marketing_consent_events
  for each row execute function forbid_change();
