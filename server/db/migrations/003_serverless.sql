-- Serverless hosting (Vercel): state that used to live in one long running
-- process now lives in the database so every function instance shares it.

-- Fixed window rate limits shared by all instances.
create table if not exists rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);
create index if not exists rate_limits_reset_idx on rate_limits(reset_at);

-- When a dispatcher claimed an email. A claim older than a few minutes means
-- the function stopped mid send; the row is safely requeued (Resend
-- idempotency keys stop a second delivery).
alter table emails add column if not exists claimed_at timestamptz;

-- Direct to storage uploads. The server records who may upload what, where,
-- before handing out a one path upload URL, and only attaches the object after
-- checking its real size and type.
create table if not exists storage_uploads (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('product_image','product_file','tutorial_thumbnail','tutorial_video')),
  target_id uuid not null,
  image_kind text,
  alt text not null default '',
  storage_key text not null unique,
  file_name text not null,
  declared_size bigint not null,
  declared_type text not null default '',
  status text not null default 'pending' check (status in ('pending','completed','rejected')),
  video_upload_id uuid,
  error text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists storage_uploads_pending_idx on storage_uploads(created_at) where status = 'pending';
