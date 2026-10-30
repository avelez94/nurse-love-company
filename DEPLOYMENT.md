# Staging preview deployment

This guide puts the full store (storefront, customer dashboard and admin dashboard) online as a **private staging preview** so it can be reviewed before anything goes live. It does not touch nurselovecompany.com, and live payments stay off.

The pieces:

| Piece | Provider used in this guide | Why |
| --- | --- | --- |
| Web server (site and API) | Render, free web service, from `render.yaml` | Runs `npm start`, restarts on crash, deploys from GitHub |
| Database | Neon PostgreSQL, free plan | Render's free database expires after a limited time; Neon's free plan does not |
| Private files (product files, images, tutorial videos) | Cloudflare R2 bucket | Render's free disk is wiped on every deploy and restart, so files must live in a bucket |
| Payments | Stripe in **test mode** | Test cards only; no real money |
| Email (optional) | Resend | Without it, emails are recorded in the admin and not sent |
| Video streaming (optional) | Mux | Without it, tutorials must be MP4 files |

## What costs money

Confirm every price on the provider's own pricing page; plans change.

| Resource | Cost in this setup |
| --- | --- |
| Render web service, `plan: free` | Free. It sleeps after about 15 idle minutes and takes up to a minute to wake. The paid "Starter" plan keeps it awake; only switch if you decide to. |
| Neon database, free plan | Free, with storage and compute limits that a review site stays well under. |
| Cloudflare R2 | Has a free monthly allowance. Cloudflare asks for a payment method on file before R2 can be turned on, and charges only beyond the free allowance. |
| Stripe test mode | Free. Test payments never move money. |
| Resend | Free tier with a monthly email limit. Sending to anyone other than yourself requires a verified domain. |
| Mux | Usage based (storage, encoding, viewing). Optional; skip it for staging. |

Nothing in `render.yaml` creates a paid resource.

## How staging access is restricted

Keeping the address secret is not protection, so the staging server locks the whole site behind a password:

* When `DEPLOY_ENV=staging`, every page and every API request must carry the staging username and password (`STAGING_ACCESS_USER`, `STAGING_ACCESS_PASSWORD`). The browser shows its built in sign in box. Wrong attempts are rate limited per address (20 per 10 minutes) and the password is compared in constant time.
* This sits **in front of** the store's own accounts. A visitor needs the staging password just to see the storefront, and an admin account on top of that to see the admin dashboard. Customer and admin dashboards keep their normal role checks.
* Two paths skip the staging password, because outside services cannot type one:
  * `/api/webhooks/stripe`, `/api/webhooks/resend`, `/api/webhooks/mux`. Each one verifies the provider's cryptographic signature with its webhook secret and rejects anything unsigned or forged. They only accept events; they never return dashboard data.
  * `/api/health`. It returns only status words (for example `"payments": "test"`), never data or secrets. Render uses it to check the server is up.
* Every response carries `X-Robots-Tag: noindex, nofollow` so search engines do not list it.
* The server refuses to start in staging if the staging password is missing or shorter than 16 characters.

## Safety rules built into the code

* **Live payments cannot run on staging.** A live Stripe key is reported as "live blocked" and checkout is switched off, even if `LIVE_PAYMENTS_APPROVED=true` is set. Only `sk_test_` keys work.
* **Missing integrations are shown, not faked.** `/api/health`, the admin Settings page and a site banner show each service as `test`, `live-blocked`, `not-configured` and so on. Checkout without Stripe says payments are not connected. Email without Resend is recorded as "not configured".
* **Misconfiguration stops the server** with a list of every problem (no database, short secret, non https address, files that would be lost on restart, missing staging password, demo content in production).
* **Migrations are safe to retry.** Each migration runs in its own transaction, is recorded once, and an advisory lock stops two starting servers from running them at the same time. A failed deploy can simply be redeployed.

## Environment variables

**Required** means the server will not start on staging without it. Values in `render.yaml` are already set; "you type it" means Render asks for it during setup or you add it under Environment.

### Core

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `DEPLOY_ENV` | Required | `render.yaml`: `staging` | Turns on the staging password gate, blocks live payments, allows demo content when asked |
| `NODE_VERSION` | Required on Render | `render.yaml`: `22` | Node version Render installs (the app needs 20.12 or newer) |
| `APP_URL` | Required | You type it | The https address Render gives the service, for example `https://nurse-love-staging.onrender.com`. Used for sign in cookies, email links and Stripe return pages |
| `DATABASE_URL` | Required | You type it (from Neon) | PostgreSQL connection string, ending in `?sslmode=require` |
| `BETTER_AUTH_SECRET` | Required | Generated by Render | Signs sign in sessions. At least 32 random characters. Changing it signs everyone out |
| `PORT` | Set by Render | Render | Port to listen on; do not set it yourself |

### Staging access and first admin

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `STAGING_ACCESS_USER` | Optional | `render.yaml`: `nurselove` | Username for the staging password box |
| `STAGING_ACCESS_PASSWORD` | Required | Generated by Render | Password for the staging password box, at least 16 characters. Share it privately |
| `ADMIN_BOOTSTRAP_TOKEN` | Optional | Generated by Render | One time setup code that turns the first signed in account into the admin. Only works while no admin exists. Delete it after use |

### Demo content

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `DEMO_CONTENT` | Optional | `render.yaml`: `false` | Set to `true` on staging to allow the "Load demo content" button. Refused in production |

### File storage

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `STORAGE_DRIVER` | Required | `render.yaml`: `s3` | `s3` for a bucket. `local` only with a persistent disk (see below) |
| `S3_ENDPOINT` | Required with `s3` | You type it (from R2) | `https://ACCOUNT_ID.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Required with `s3` | You type it | Bucket name, for example `nurse-love-staging` |
| `S3_REGION` | Optional | `render.yaml`: `auto` | `auto` for R2 |
| `S3_ACCESS_KEY_ID` | Required with `s3` | You type it (from R2 API token) | Bucket access key |
| `S3_SECRET_ACCESS_KEY` | Required with `s3` | You type it (from R2 API token) | Bucket secret key |
| `LOCAL_STORAGE_DIR` | Required with `local` | You type it | Absolute path on a persistent disk, for example `/var/data/storage` (needs a paid Render disk) |
| `MAX_PRODUCT_FILE_MB` | Optional | `render.yaml`: `100` | Largest product file upload |
| `MAX_IMAGE_MB` | Optional | `render.yaml`: `10` | Largest image upload |
| `MAX_VIDEO_MB` | Optional | `render.yaml`: `150` | Largest tutorial video upload without Mux |

Uploads to the bucket pass through the server's memory, so the limits are kept below the free plan's 512 MB. Raise them only on a larger plan. With Mux, videos upload straight to Mux and this limit does not apply.

### Payments (Stripe, test mode only)

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Optional | You type it | Must start with `sk_test_`. Without it, checkout says payments are not connected |
| `STRIPE_WEBHOOK_SECRET` | Optional, needed with Stripe | You type it | `whsec_...` from the Stripe webhook you create. Without it, paid orders are never marked paid |
| `LIVE_PAYMENTS_APPROVED` | Optional | `render.yaml`: `false` | Ignored on staging. In production, live keys need this set to `true` after the owner approves launch |

### Email (Resend)

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Optional | You type it | Without it, emails are recorded as "not configured" and nothing is sent |
| `RESEND_FROM` | Optional, needed with Resend | You type it | For example `Nurse Love Company <hello@your-verified-domain.com>` |
| `RESEND_WEBHOOK_SECRET` | Optional | You type it | `whsec_...` from the Resend webhook, for delivery and bounce tracking |

### Video (Mux)

| Variable | Required | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `VIDEO_PROVIDER` | Optional | `render.yaml`: `local` | `local` stores MP4 files in the bucket. `mux` streams through Mux |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Needed with `mux` | You type them | Mux access token |
| `MUX_WEBHOOK_SECRET` | Needed with `mux` | You type it | Tells the store when a video is ready |
| `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` | Optional with `mux` | You type them | Lets admins preview unpublished videos privately |

Without Mux, Render has no ffmpeg, so tutorial uploads must be MP4. MOV or WebM uploads fail with a message saying so.

### Development only

`SEED_DEMO`, `DEV_DB_PORT`, `EXTRA_ORIGINS`, `TEST_DATABASE_URL` are for running on a computer and tests. Leave them unset on Render.

## First admin, securely

No admin account exists on a fresh deployment, and no default admin password exists anywhere in the code for staging or production.

1. Open the staging address, enter the staging password, then **Create account** with the owner's email and a strong password of her own.
2. While signed in, go to `/#admin-setup`.
3. Enter the `ADMIN_BOOTSTRAP_TOKEN` value (Render, the service, Environment, reveal the value).
4. The account becomes the admin and the action is written to the audit log. The setup page stops working as soon as one admin exists, and wrong codes are rate limited.
5. In Render, **delete** `ADMIN_BOOTSTRAP_TOKEN` and save. The page then answers "not available".

Alternative with shell access (paid Render plans have a Shell tab): `npm run admin:create -- owner@example.com` after that person has signed up.

## Labeled demo content

For reviewing both dashboards without building a catalog by hand.

* Off by default. It only works when `DEPLOY_ENV=staging` **and** `DEMO_CONTENT=true`. Production refuses to start with `DEMO_CONTENT` on.
* Load it from Admin, Settings, **Demo content**, "Load demo content". Optionally enter a reviewer's email (an account that already signed up) to give that account three sample orders showing each download state: already downloaded, a new release available, and ready to download.
* Every item is marked Demo in the admin, on product pages and on receipts, and can be excluded from revenue with the "Include demo data" switch. CSV exports mark demo rows.
* Safe to press more than once: nothing is duplicated, even if pressed twice at the same moment.
* Sample shoppers use `@demo.invalid` addresses with random passwords no one knows. No admin is created and no demo login exists.
* Demo emails are recorded as "suppressed" and never sent. Demo products can only be bought with Stripe test cards.

## Keeping uploads through restarts

Render's free service has no persistent disk, so `STORAGE_DRIVER=local` without a disk would lose every upload on restart. The server refuses to start in that state. Use the R2 bucket (`STORAGE_DRIVER=s3`). The paid alternative is a Render disk mounted at, say, `/var/data` with `STORAGE_DRIVER=local` and `LOCAL_STORAGE_DIR=/var/data/storage`.

## Step by step

1. **Neon database.** Sign up at neon.tech (free). Create a project named `nurse-love-staging`. Copy the connection string (it contains the database password; keep it private).
2. **Cloudflare R2 bucket.** In the Cloudflare dashboard open R2 (a payment method is required to turn it on; usage within the free allowance is not charged). Create a bucket `nurse-love-staging`, keep it **private**. Create an R2 API token with "Object Read and Write" on that bucket only. Note the access key ID, secret access key and the S3 endpoint.
3. **Render.** Sign up at render.com with GitHub and allow access to the `nurse-love-company` repository only. Choose New, Blueprint, pick the repository. Render reads `render.yaml` and asks for each "you type it" value. Fill in `DATABASE_URL` and the `S3_*` values; leave Stripe, Resend and Mux empty for now. For `APP_URL`, enter `https://nurse-love-staging.onrender.com` (if Render gives a different address, update it afterwards).
4. **Check it runs.** Open `https://YOUR-ADDRESS/api/health`: it should say `"status":"ok"`, `"environment":"staging"`, with payments and email `not-configured`. Open the site itself: the browser asks for the staging username `nurselove` and the password from Render's Environment tab.
5. **First admin.** Follow "First admin, securely" above, then delete `ADMIN_BOOTSTRAP_TOKEN`.
6. **Stripe test mode.** In Stripe, stay in test mode, copy the `sk_test_` secret key into `STRIPE_SECRET_KEY`. Add a webhook endpoint `https://YOUR-ADDRESS/api/webhooks/stripe` with the events listed in the README, copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Buy something with card `4242 4242 4242 4242`.
7. **Optional: demo content.** Set `DEMO_CONTENT=true`, let it redeploy, then use the button in Admin, Settings.
8. **Optional: Resend, Mux.** Add their keys and webhook addresses the same way.

Render redeploys automatically on every push to `main` once connected. To stop that, turn off Auto Deploy in the service settings.
