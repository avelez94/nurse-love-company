# Staging preview on Vercel and Supabase

This guide puts the full store (storefront, customer dashboard, admin dashboard, tutorials) online as a **private staging preview**, so it can be reviewed before anything goes live. It does not touch nurselovecompany.com or its DNS, and live payments stay off.

| Piece | Service |
| --- | --- |
| Storefront pages and the API | Vercel (static files from `dist/`, the API as one Vercel Function at `api/index.ts`) |
| Store data, accounts and sessions | Supabase PostgreSQL |
| Product files, photos, sample pages, tutorial videos | Supabase Storage (two private buckets) |
| Email | Resend (optional until you want real emails) |
| Payments | Stripe in **test mode** |
| Video streaming | Mux, optional and left disconnected |

> **Obsolete:** the earlier Render, Neon and Cloudflare R2 plan. `render.yaml` has been removed. The settings `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `LOCAL_STORAGE_DIR`, `NODE_VERSION` and `PORT` are not used on Vercel. Leave them unset there. The `s3` and `local` storage drivers still exist for running the store on a computer or a single server.

## What changed for Vercel, and why

| Area | Before (one long running Node server) | Now on Vercel |
| --- | --- | --- |
| Server entry and routing | `server/index.ts` served the API and `dist/` | `api/index.ts` exports the same Hono app as a Vercel Function. `vercel.json` sends every `/api/...` request to it. Vercel serves `dist/` itself. `server/index.ts` is still used for local development. |
| Accounts and sessions | Better Auth, httpOnly cookies, sessions in PostgreSQL | **Unchanged.** It already keeps sessions in the database, so it works the same across serverless instances. Its rate limit now uses the database too. No Supabase Auth is needed (see "Accounts" below). |
| Database connections | Pool of 10, migrations at start up | A pool of 3 per instance through Supabase's connection pooler. Idle connections close before an instance sleeps. Locks that previously assumed one session now use transaction locks, which work through the pooler. |
| File uploads | Browser sent files to the server | Vercel limits request bodies (4.5 MB), so files go **straight from the admin's browser to Supabase Storage** through a one path upload link the server issues. The server then reads the file back, checks its real type and size, and only then attaches it. |
| Downloads | Streamed by the server after atomic redemption | **Unchanged rule.** Still streamed by the function after the database redeems the download atomically. No storage link is ever created for a purchasable file. |
| Photos and tutorial videos | Streamed by the server | The server checks permission on every request, then redirects to a Supabase signed link that lasts one hour. |
| Email sending | In memory loop every 30 seconds | The request that queues an email also sends it, kept alive with `waitUntil`. A scheduled job (`/api/cron/maintenance`) retries anything a stopped instance left behind. Duplicate protection is unchanged. |
| Rate limits | In memory | Stored in the database, so they hold across instances. |
| Migrations | Ran at every server start | **Never** inside functions. They run deliberately with `npm run migrate`, from GitHub Actions or a computer. |
| Staging password | Checked by the server | Checked by `middleware.ts` before Vercel serves any page or file, and again by the API. |

## How staging access is restricted

Keeping the address secret is not protection. The staging site is locked with a password at two layers:

1. **`middleware.ts` (Vercel Routing Middleware)** runs before Vercel serves anything, including the static storefront and dashboard pages. Without the staging username and password, every page, script, image and API call gets `401` and the browser's sign in box.
2. **The API** repeats the same check, with wrong attempts rate limited (20 per 10 minutes per address), so it holds even if the middleware were bypassed.

On top of that, the admin dashboard needs an admin account, and the customer dashboard needs a customer account, exactly as before.

Paths that skip the staging password, because the services calling them cannot type one:

| Path | Who calls it | What protects it |
| --- | --- | --- |
| `/api/webhooks/stripe` | Stripe | Stripe's signature, checked against `STRIPE_WEBHOOK_SECRET` on the raw body |
| `/api/webhooks/resend` | Resend | Svix signature, checked against `RESEND_WEBHOOK_SECRET` |
| `/api/webhooks/mux` | Mux | Mux signature, checked against `MUX_WEBHOOK_SECRET` |
| `/api/cron/maintenance` | Vercel Cron | `Authorization: Bearer CRON_SECRET`, compared in constant time |
| `/api/health` | You, monitoring | Returns status words only, never data or secrets |

None of these return dashboard data. Every response is marked `noindex`.

**Vercel's own Deployment Protection** can be added on top, but it blocks webhooks unless you also set up its bypass secret. Because the store's own password already covers everything, this guide does not rely on it.

## Files, uploads and storage rules

Two **private** buckets, created by `npm run migrate`:

| Bucket | Holds | Who can read it |
| --- | --- | --- |
| `product-files` | Purchasable downloads, every version | Only the server, only during a redeemed download. The code refuses to create a signed link for this bucket. |
| `media` | Product photos, sample pages, tutorial videos, thumbnails | Visitors receive a one hour signed link, issued only after the server confirms the item is visible to them. |

Visibility rules, checked by the server on every request:

* **Product photos and sample pages:** visible while the product is published. Draft product images are admin only.
* **Tutorial videos, thumbnails and captions:** visible only while the tutorial is published. Drafts and unpublished tutorials return "not found" to the public. Admins can preview drafts.
* After unpublishing, no new links are issued. A link given out just before unpublishing keeps working until it expires, at most one hour later.

Both buckets are private, rather than one being public, so that publish and unpublish take effect without copying files and without a public CDN copy lingering after unpublishing.

**Uploads** go straight from the admin's browser to storage:

1. The admin's browser asks the store for an upload. The server checks the admin, the product or tutorial, the file type and the size, and records exactly where the file may go.
2. The server returns a one path upload link (valid about two hours, cannot overwrite anything, useless for any other path).
3. The browser sends the file to Supabase Storage.
4. The browser tells the store it is done. The server reads the file back from storage, checks its real type from its first bytes, its real size and its SHA-256, and only then attaches it. Anything that fails is deleted. Confirming twice attaches once.

Unfinished uploads are cleaned up by the scheduled job. Product files stay invisible to customers until the product is saved with them.

### File limits and formats

| Kind | Formats | Limit on Supabase's free plan |
| --- | --- | --- |
| Product download files | PDF, ZIP, PNG, JPG | 50 MB (`MAX_PRODUCT_FILE_MB`) |
| Product photos and sample pages | PNG, JPG, WebP | 10 MB (`MAX_IMAGE_MB`) |
| Tutorial thumbnails | PNG, JPG, WebP | 10 MB |
| Tutorial videos | **MP4 only** (H.264 video, AAC audio) | 50 MB (`MAX_VIDEO_MB`) |

Supabase's free plan caps every stored file at 50 MB. A paid Supabase plan lets you raise that project setting, and then the `MAX_*` values here. Vercel has no ffmpeg, so videos are played exactly as uploaded: export them as MP4 with "optimize for web" or "fast start" turned on, so playback can begin before the whole file loads. MOV and WebM are refused with a message saying to convert to MP4 first. For longer videos, Mux can be connected later.

## The strict download rule on Vercel

The rule is unchanged and still enforced in the database:

* Each purchased digital product gets one download. Publishing a new version gives each eligible buyer one new download for that version. Listing edits, email resends and password resets grant nothing.
* A download starts with a short lived token tied to the signed in customer. Delivery checks ownership, then redeems the token and the download together, in one transaction, with conditional updates. Of many simultaneous requests, exactly one succeeds. A reused or shared link fails.
* The file is opened **before** anything is used up, so a storage outage leaves the download available.
* The file streams from the private bucket through the function. **No reusable Supabase link is ever created for a purchasable file.**

Limits that matter here:

* **Function duration:** `vercel.json` allows 300 seconds. A 50 MB file needs a connection of roughly 1.5 Mbps or better to finish in that time. If a transfer is cut off, the download is already used (the server cannot know whether the file was saved). The event log shows it started but did not finish, the customer can report a problem, and an admin can grant an audited replacement. This is the same safety net as before.
* **Response size, to verify on staging:** Vercel caps ordinary function responses at 4.5 MB. Streamed responses work differently, and I could not open Vercel's documentation from the build environment to confirm their current ceiling. **The first staging check below is to download a test file larger than 5 MB.** If Vercel cuts it short, do not swap in a signed storage link. The smallest fix that keeps the rule is chunked delivery: one redemption opens a delivery session bound to the signed in customer for a few minutes, and the browser fetches the file in pieces under 4.5 MB through the same function, so there is still no reusable link. That would be a separate, reviewed change.

## Background work

* **Email:** a queued email is sent by the same request that created it, kept alive with `waitUntil`. If an instance stops mid send, the row stays in the database. The next queued email, or the scheduled job, sends it again with the same Resend idempotency key, so it is never delivered twice. After five stalled attempts it is marked failed and shows in the email center. Demo emails are recorded as "suppressed" and never sent. All logs, resends and webhooks are unchanged.
* **Scheduled job:** `vercel.json` runs `/api/cron/maintenance` every hour (at 17 minutes past), which the Pro plan allows. Besides retrying emails, it sends due download reminders and review requests. Precision: an automation email becomes due at its exact time and goes out on the next hourly run, so up to about an hour later. After downtime, overdue emails go out on the next run, still rechecked. (On the free Hobby plan Vercel only allows a daily job; Supabase Cron with `pg_net` can call the same address with the `Authorization: Bearer CRON_SECRET` header instead.)
* **Tutorial videos** are checked when the upload completes. There is no background processing on Vercel.

## Migrations

Migrations never run inside Vercel Functions. The database is set up deliberately, once, in Supabase itself:

* **First setup (recommended): Supabase SQL Editor.** In the Supabase dashboard open **SQL Editor**, **New query**, paste the whole of [`supabase/setup.sql`](supabase/setup.sql), and click **Run**. It creates the account tables, the store tables, row level security and the two private storage buckets, in one transaction (all or nothing). On a database that is already set up it stops with "already set up" and changes nothing. The file is generated from the migrations (`npm run db:sql`), and a test checks it builds exactly the database `npm run migrate` would.
* **Later updates:** when a release adds a file to `server/db/migrations/`, that release also adds the same change as a ready to paste script in `supabase/updates/`. Paste and run it the same way.
* **Optional alternatives:** the "Run database migrations" GitHub Action (it needs a GitHub environment with the secrets listed below), or from a computer: `DATABASE_URL=... STORAGE_DRIVER=supabase SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate` with Supabase's **Session pooler** connection string (port 5432). Both are safe to run again: each migration runs once, in its own transaction, under a lock.

`/api/health` reports `"schema": "behind"` (and returns 503) if the code expects a migration the database does not have yet.

Migrations also switch on row level security, with no policies, for every store table. Supabase publishes the `public` schema through its Data API. With row level security on, that API sees nothing, while the store's own server connection is unaffected.

## Keeping staging and production apart

* Staging gets its **own Supabase project** and its **own Vercel project**. The future live store gets a separate Supabase project and Vercel project. They share no database, storage, keys or webhooks.
* In the staging Vercel project, add the variables to the **Production** environment only. Branch preview deployments then have no settings, show "not configured", and cannot touch staging data.
* Stripe stays in test mode for staging. Live keys are refused on staging even if someone sets them.

## Accounts

The store keeps its own accounts (Better Auth). That is secure and needs no change on Vercel: passwords are hashed with scrypt, sessions are httpOnly cookies stored in the database, roles cannot be set from the browser, and sign in is rate limited across instances. Supabase Auth is **not** used, and no migration to it is proposed. In Supabase, leave Authentication unconfigured.

## Environment variables

### Vercel (staging project, Production environment)

| Variable | Required | Value |
| --- | --- | --- |
| `DEPLOY_ENV` | Required | `staging` |
| `APP_URL` | Required | The project's address, for example `https://nurse-love-staging.vercel.app` (no trailing slash) |
| `DATABASE_URL` | Required | Supabase **Transaction pooler** connection string (port 6543), with your database password filled in and no `sslmode` |
| `DATABASE_SSL_CA` | Required | The Supabase CA certificate (Database settings, SSL, download certificate), pasted in whole. The database driver verifies the server against it |
| `BETTER_AUTH_SECRET` | Required | 64 random characters, for example from `openssl rand -hex 32`. Changing it signs everyone out |
| `STAGING_ACCESS_PASSWORD` | Required | 24 or more random characters. Share it privately with reviewers |
| `CRON_SECRET` | Required | 32 or more random characters. Vercel Cron sends it automatically |
| `RESEND_AUDIENCE_ID` | Optional | The Resend audience that holds the marketing email list. Without it, signups are stored and wait; Resend still sends order emails |
| `DELIVERY_WEBHOOK_SECRET` | Optional | Only once Printful or carrier tracking is connected: signs delivery events sent to `/api/webhooks/delivery` (see `server/routes/automations.ts`). Until then, delivery dates are recorded by the owner |
| `STORAGE_DRIVER` | Required | `supabase` |
| `SUPABASE_URL` | Required | `https://YOUR-PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | The project's secret key (the `service_role` key, or the newer "secret" key). Mark it **Sensitive** in Vercel. It never reaches the browser |
| `STAGING_ACCESS_USER` | Optional | Defaults to `nurselove` |
| `ADMIN_BOOTSTRAP_TOKEN` | Optional | 32 or more random characters for the one time admin setup. **Delete after use** |
| `DEMO_CONTENT` | Optional | `true` to allow the "Load demo content" button. Staging only |
| `STRIPE_SECRET_KEY` | Optional | Must start with `sk_test_`. Without it, checkout says payments are not connected |
| `STRIPE_WEBHOOK_SECRET` | With Stripe | `whsec_...` from the Stripe test mode webhook |
| `RESEND_API_KEY` | Optional | Without it, emails are recorded as "not configured" and nothing is sent |
| `RESEND_FROM` | With Resend | For example `Nurse Love Company <hello@your-verified-domain.com>` |
| `RESEND_WEBHOOK_SECRET` | Optional | `whsec_...` from the Resend webhook, for delivery tracking |
| `VIDEO_PROVIDER` | Optional | `local` (default: MP4s in Supabase Storage) or `mux` |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` | With Mux | Leave unset for now |
| `MAX_PRODUCT_FILE_MB`, `MAX_IMAGE_MB`, `MAX_VIDEO_MB` | Optional | Defaults 50, 10, 50. Keep at or below Supabase's file size limit |
| `SUPABASE_FILES_BUCKET`, `SUPABASE_MEDIA_BUCKET` | Optional | Defaults `product-files` and `media` |
| `DB_POOL_MAX` | Optional | Connections per instance, default 3 |
| `LIVE_PAYMENTS_APPROVED` | Leave unset | Ignored on staging. Only for the future live store, after the owner approves launch |

Vercel sets `VERCEL` itself. If any required value is missing or invalid, every API request answers 503 "not fully configured", and the exact list is in the function logs (Vercel project, Logs).

### GitHub (optional; only if you use the migration workflow instead of the SQL Editor)

| Name | Kind | Value |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Supabase **Session pooler** connection string (port 5432) |
| `DATABASE_SSL_CA` | Secret | Same certificate as in Vercel |
| `SUPABASE_URL` | Secret | Same as in Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Same as in Vercel |
| `MAX_PRODUCT_FILE_MB`, `MAX_VIDEO_MB` | Variable, optional | Only if you changed them in Vercel; they set the bucket limits |

### Not used on Vercel

`PORT`, `LOCAL_STORAGE_DIR`, `S3_*`, `NODE_VERSION`, `SEED_DEMO`, `DEV_DB_PORT`, `EXTRA_ORIGINS`, `TEST_DATABASE_URL`.

## What costs money

Confirm every price on the provider's own pricing page; I could not open them from the build environment.

| Resource | Cost |
| --- | --- |
| Vercel Hobby | Free, but Vercel limits Hobby to **non commercial personal use**. The live store will need **Vercel Pro (paid, per team member per month)**. Whether a private review copy of a business site may sit on Hobby is Vercel's call; choosing Pro for staging too keeps you clearly within their terms. **Decide before creating the project.** |
| Supabase Free | Free: a small database, about 1 GB of file storage, a 50 MB per file cap, and the project pauses after a week without activity (restore it in the dashboard). Two free projects per account. **Supabase Pro is paid** and is recommended for the live store (backups, no pausing). |
| Stripe test mode | Free. No real money moves. |
| Resend | Free tier with a monthly limit. Sending to anyone but yourself needs a verified domain. Do not use nurselovecompany.com's DNS for this without deciding that separately. |
| Mux | Usage based. Not needed now. |
| Function time and transfer | Downloads and checks run through the function and count toward Vercel's included usage. A review site stays far below it. |

## First admin, securely

No admin exists on a fresh deployment, and there is no default admin password anywhere.

1. Open the staging address, enter the staging password, then **Create account** with the owner's email and a strong password of her own.
2. While signed in, go to `/#admin-setup`.
3. Enter the `ADMIN_BOOTSTRAP_TOKEN` value (Vercel project, Settings, Environment Variables).
4. The account becomes the admin, and the action is written to the audit log. The setup page stops working as soon as one admin exists, and wrong codes are rate limited.
5. Delete `ADMIN_BOOTSTRAP_TOKEN` in Vercel and redeploy. The page then answers "not available".

## Labeled demo content

* Off by default. It only works with `DEPLOY_ENV=staging` **and** `DEMO_CONTENT=true`. Production refuses to start with it on.
* Load it from Admin, Settings, Demo content. Optionally enter a reviewer's email (an account that already signed up) to give that account three sample orders, one in each download state.
* Everything is labeled Demo, can be excluded from revenue, and is marked in CSV exports. Pressing the button twice duplicates nothing. Sample shoppers use `@demo.invalid` addresses with random passwords nobody knows. Demo emails are never sent. Demo products can only be bought with Stripe test cards.

## Step by step

Each step says what it costs. Nothing has been created yet.

1. **Supabase project** (free plan). Create a project named `nurse-love-staging`, choose a strong database password, and pick a region near you. Do not set up Supabase Auth.
2. **Collect from Supabase:** project URL and secret (service role) key, from Project Settings, API. Transaction pooler and Session pooler connection strings, from Connect. The CA certificate, from Database settings, SSL.
3. **Database setup in Supabase:** SQL Editor, New query, paste `supabase/setup.sql`, Run. This creates the tables and the two private buckets.
4. **Vercel project** (decide Hobby or Pro first). Import the `nurse-love-company` repository. Vercel reads `vercel.json`. Before the first deploy, add the required variables to the Production environment.
5. **Check it:** `https://YOUR-ADDRESS/api/health` should show `"status":"ok"`, `"schema":"current"`, `"storage":"supabase"`. The site itself should ask for the staging password.
6. **First admin**, then delete `ADMIN_BOOTSTRAP_TOKEN`.
7. **Upload tests:** a product photo, a product PDF over 5 MB, a tutorial MP4. Publish the product file as an update, buy it with a Stripe test card, and download it once. **This confirms the large download works on Vercel.**
8. **Stripe test mode:** add `STRIPE_SECRET_KEY` (`sk_test_`), and a webhook to `https://YOUR-ADDRESS/api/webhooks/stripe` with the events listed in the README. Add its signing secret as `STRIPE_WEBHOOK_SECRET`.
9. **Optional:** set `DEMO_CONTENT=true` and load demo content. Later, Resend.

Vercel redeploys on every push to `main` once connected. Pushes do not change the database; when a release adds a migration, run its script from `supabase/updates/` in the SQL Editor.
