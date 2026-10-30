# Nurse Love Company store

Made by a nurse, for nurses.

The Nurse Love Company storefront (the approved design), plus a customer dashboard and an owner admin dashboard. It runs fully on your own computer with demo data. Real payments, email and cloud storage switch on when their keys are added; until then the site says so plainly and never pretends.

## Run it on your computer

Requirements: Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The first run creates a private local database in `.data/` and fills it with labeled demo data.

Demo sign ins (local only, never created in production):

| Who | Email | Password |
| --- | --- | --- |
| Store owner (admin) | owner@nurselove.test | NurseLoveAdmin1! |
| Customer | demo.customer@nurselove.test | NurseLoveDemo1! |

The admin dashboard is at http://localhost:5173/#admin.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the server test suite against a PostgreSQL test database (see Tests) |
| `npm run build` | Type checks everything and builds the site into `dist/` |
| `npm start` | Runs the production server (serves the API and the built site) |
| `npm run seed` | Adds the demo data again (development only) |
| `npm run admin:create -- you@example.com` | Gives an existing account admin access |

## How it is built

* **Storefront and dashboards:** React, TypeScript and Vite (`src/`). The approved design is unchanged. Admin code loads only for admins.
* **Server:** Node with Hono (`server/`). Every endpoint checks the signed in user and role on the server; hidden buttons are never the security.
* **Database:** PostgreSQL with SQL migrations in `server/db/migrations/`. Rules that must never break (one unused download per purchase, no duplicate grants, immutable file versions, append only audit log) are enforced by the database itself.
* **Accounts:** Better Auth (email and password, httpOnly session cookies, scrypt password hashing, rate limited sign in). Customer and admin roles live on the server; the browser cannot set them.
* **Payments:** Stripe Checkout. The store never sees card details. Orders become paid only from a signature verified Stripe webhook, and each webhook event is processed once.
* **Email:** Resend, through an outbox that stores a snapshot of every email and can never send the same email twice.
* **Private files:** S3 compatible storage (Cloudflare R2, AWS S3, Backblaze B2 or Supabase Storage) in production; a private folder in development.
* **Tutorial video:** Mux in production (direct uploads, adaptive streaming, automatic thumbnails); local processing with ffmpeg in development. YouTube and Vimeo links also work.
* **Rich text:** a controlled Tiptap editor. Descriptions are stored as structured content, not HTML, and cleaned on the server on every save. Allowed: bold, italic, lists, links, two heading sizes, two font styles and two text sizes.

## The download rule

* Each purchased digital product includes **one** download of the latest released version.
* Downloads need a signed in customer who owns a paid, unrefunded order.
* Viewing the dashboard, previewing a product, resending an email, resetting a password or editing a listing never grants or uses a download.
* Clicking **Download** (after the "You have one download available. Save the file somewhere you can find it again." confirmation) creates a single use link that expires in 2 minutes and only works for the same signed in customer. The download is used, in one database transaction, at the moment the server starts sending the file. Twelve simultaneous requests produce exactly one download (this is tested).
* If the file cannot be read from storage, the download is **not** used, and the customer sees that.
* **Publish digital product update** (an explicit admin action) uploads a new private file, creates an immutable version, shows how many purchasers are affected, and gives each eligible purchaser exactly one new download. An older unused download is replaced, never added to. Retrying the same release grants nothing twice and sends no duplicate emails.
* Customers can **Report a download problem**. An admin can grant one replacement download, which requires a written reason and is recorded in the audit log. Nothing is ever reset automatically.
* Digital items are always quantity one, and buying a digital product you already own is blocked, until the owner decides otherwise.
* **Honest limit:** the store controls who can download and how many times. Once a file is saved on someone's device, the store cannot prevent copying, and the server cannot prove the file was saved successfully.
* **Refunds:** by default, a fully refunded digital line loses its unused download. This is a setting in Admin, Settings, Policies, and it needs the owner's approval.

Tutorials are completely separate: watching never touches downloads or purchases, and only published tutorials can be listed or played publicly.

## Demo data

Everything created by the seed is marked `is_demo` and labeled "Demo" in the admin, on product pages ("Demo price") and on receipts. Demo prices are placeholders, not approved prices. Demo files are generic prototype PDFs. The overview has an "Include demo data" switch, and CSV exports mark demo rows. Demo data is never created in production. On staging it is off unless `DEMO_CONTENT=true`, and then loaded from Admin, Settings (see DEPLOYMENT.md).

The tutorial "How to Put Together Your NP Binder" uses a short, clearly labeled placeholder video. It is not the owner's recording.

## Awaiting configuration

| Service | Status now | What is needed |
| --- | --- | --- |
| Stripe payments | Not connected. Checkout says so and charges nothing. | Stripe account, test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Live keys are refused unless `LIVE_PAYMENTS_APPROVED=true` is set after the owner approves launch. Optional: Stripe Tax for sales tax. |
| Resend email | Not connected. Emails are logged as "not configured" and nothing is sent. | Resend account, verified sending domain, `RESEND_API_KEY`, `RESEND_FROM`, webhook secret for delivery tracking. |
| File storage | Local private folder. | A bucket (Cloudflare R2, AWS S3, Backblaze B2 or Supabase Storage S3) and its keys. |
| Tutorial video | Local processing (fine for short clips). | Mux account: token ID and secret, webhook secret, and a signing key for admin previews of unpublished videos. |
| Database | Local, created automatically. | A hosted PostgreSQL database, for example Supabase or Neon (`DATABASE_URL`). |
| Shipping | Off. Items that ship cannot be bought yet. | Flat rate and countries in Admin, Settings, Shipping. |
| Policies | Empty, marked "awaiting approval". | Refund, shipping, terms and privacy text from the owner, and the refund download decision. |
| Contact details | Empty. | Contact and support email in Admin, Settings. |
| Real products | Demo products. | Titles, descriptions, approved prices, photos, sample pages, files, confirmed page counts, sizes, formats and app compatibility. |
| Two way support email | Customers can send messages; admins read them in the dashboard. | Reply from your own email for now. |

Copy `.env.example` to `.env` to add keys. Secrets stay on the server and are never sent to the browser.

### Webhook addresses

* Stripe: `https://YOUR-DOMAIN/api/webhooks/stripe` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`)
* Resend: `https://YOUR-DOMAIN/api/webhooks/resend` (all email events)
* Mux: `https://YOUR-DOMAIN/api/webhooks/mux`

## Hosting costs

Prices change, so confirm each one on the provider's own pricing page before launch. What each service charges for:

* **Stripe:** no monthly fee on the standard plan; a percentage plus a fixed fee per successful card payment. Stripe Tax adds a per transaction fee if turned on.
* **Resend:** free tier with a monthly email limit; paid plans by email volume.
* **Mux:** charges by minutes of video stored, encoded and watched. A small library of short tutorials usually sits near the bottom of their usage pricing.
* **Database:** Supabase and Neon both have free tiers that suit a launch, with paid plans for more storage and backups.
* **File storage:** Cloudflare R2 charges for storage with no download (egress) fees; S3 charges for storage and downloads.
* **Server:** any Node host (Render, Railway, Fly.io, a small VPS). Expect a small monthly plan. Vercel is not a good fit for this server as written, because it streams large uploads.

## Tests

Server tests run against a real PostgreSQL database (default `postgres://nurselove:nurselove-local@localhost:5432/nurselove_test`, or set `TEST_DATABASE_URL`).

```bash
npm test
```

They cover: successful, failed, unpaid and duplicate payment events; forged webhooks; another customer's orders and files; anonymous and customer access to admin endpoints; cross site requests; first download and blocked second download; simultaneous downloads; a download link used by someone else; failed file preparation; problem reports and audited replacements; a new release granting exactly one new download per purchaser with safe retries; listing edits, email resends and password resets granting nothing; archived products keeping history and downloads; drafts staying private; rich text cleaning; mixed digital and physical orders with shipping, tracking and receipt snapshots; refunds; reporting math; Resend delivery events, bounces and suppression; video upload, processing, failed upload recovery, publishing and unpublishing; tutorials never touching downloads; and the audit log.

## Deploying

A private staging preview runs on Render from `render.yaml`, with a Neon database and a Cloudflare R2 bucket. **DEPLOYMENT.md** has the step by step guide, every environment variable (required and optional), how staging access is locked, how to create the first admin securely, and the optional labeled demo content.

In short:

1. Set `DEPLOY_ENV` (`staging` or `production`), `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, persistent file storage and, on staging, `STAGING_ACCESS_PASSWORD`. The server lists anything missing and refuses to start.
2. `npm ci --include=dev && npm run build`, then `npm start`. Migrations run automatically at start up and are safe to repeat.
3. Sign up, then claim the admin role at `/#admin-setup` with `ADMIN_BOOTSTRAP_TOKEN` (remove it afterwards), or run `npm run admin:create -- owner@example.com` on the server.
4. Add the webhook addresses above in Stripe, Resend and Mux.
5. Test a full order with a Stripe test card. Live payments are always blocked on staging.

`GET /api/health` reports the database and each integration and returns 503 if the database is unreachable.

## Where things live

```
server/            API server
  db/migrations/   Database schema
  services/        Business rules (entitlements.ts has the download rule)
  routes/          Public, account, admin and webhook endpoints
  tests/           Automated tests
shared/            Code used by both the browser and the server
src/               Storefront, customer dashboard and admin dashboard
  pages/account/   Customer dashboard
  pages/admin/     Admin dashboard
```
