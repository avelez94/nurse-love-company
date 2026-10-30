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
| `npm start` | Runs the API and built site as one Node server (not used on Vercel) |
| `npm run migrate` | Applies database migrations and sets up the storage buckets (run deliberately; see DEPLOYMENT.md) |
| `npm run db:sql` | Regenerates `supabase/setup.sql`, the paste into Supabase setup script |
| `npm run seed` | Adds the demo data again (development only) |
| `npm run admin:create -- you@example.com` | Gives an existing account admin access |

## How it is built

* **Storefront and dashboards:** React, TypeScript and Vite (`src/`). The approved design is unchanged. Admin code loads only for admins.
* **Server:** Node with Hono (`server/`), run as one Vercel Function in staging and production, or as a normal Node server locally. Every endpoint checks the signed in user and role on the server; hidden buttons are never the security.
* **Database:** PostgreSQL with SQL migrations in `server/db/migrations/`. Rules that must never break (one unused download per purchase, no duplicate grants, immutable file versions, append only audit log) are enforced by the database itself.
* **Accounts:** Better Auth (email and password, httpOnly session cookies, scrypt password hashing, rate limited sign in). Customer and admin roles live on the server; the browser cannot set them.
* **Payments:** Stripe Checkout. The store never sees card details. Orders become paid only from a signature verified Stripe webhook, and each webhook event is processed once.
* **Email:** Resend, through an outbox that stores a snapshot of every email and can never send the same email twice. Emails are sent by the request that queues them, and a scheduled job retries anything left behind.
* **Private files:** two private Supabase Storage buckets when hosted (purchasable files, which are only ever streamed after a redeemed download, and media, shown through short lived links when allowed). Admins upload straight to storage and the server checks each file before using it. A private folder in development.
* **Tutorial video:** MP4 files in Supabase Storage when hosted (played as uploaded, no conversion). Mux can be connected later for streaming. Local processing with ffmpeg in development. YouTube and Vimeo links also work.
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
| File storage | Local private folder. | Supabase Storage (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). `npm run migrate` creates the two private buckets. |
| Tutorial video | Local processing on a computer. On Vercel: MP4 files played as uploaded (up to 50 MB on Supabase's free plan). | Optional Mux account for longer videos: token ID and secret, webhook secret, and a signing key for admin previews. |
| Database | Local, created automatically. | A Supabase project (`DATABASE_URL`, `DATABASE_SSL_CA`). |
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
* **Database and file storage:** Supabase has a free plan (with a 50 MB per file cap, and pausing after a week without activity) and a paid Pro plan recommended for the live store.
* **Hosting:** Vercel. Its free Hobby plan is for non commercial personal use only, so the live store needs Vercel Pro (paid per team member).

## Tests

Server tests run against a real PostgreSQL database (default `postgres://nurselove:nurselove-local@localhost:5432/nurselove_test`, or set `TEST_DATABASE_URL`).

```bash
npm test
```

They cover: successful, failed, unpaid and duplicate payment events; forged webhooks; another customer's orders and files; anonymous and customer access to admin endpoints; cross site requests; first download and blocked second download; simultaneous downloads; a download link used by someone else; failed file preparation; problem reports and audited replacements; a new release granting exactly one new download per purchaser with safe retries; listing edits, email resends and password resets granting nothing; archived products keeping history and downloads; drafts staying private; rich text cleaning; mixed digital and physical orders with shipping, tracking and receipt snapshots; refunds; reporting math; Resend delivery events, bounces and suppression; video upload, processing, failed upload recovery, publishing and unpublishing; tutorials never touching downloads; the audit log; and, through the real Vercel function entry with a local stand in for Supabase Storage: the staging password on every page, sign in and roles, direct uploads with type and size checks, private files that never get a storage link, one time downloads under simultaneous requests, version updates, signed media only for published tutorials and products, webhook signatures, and the scheduled email retry.

## Deploying

The staging preview runs on **Vercel** (storefront and API) with **Supabase** (database and private file storage). **DEPLOYMENT.md** has the step by step guide, every environment variable for Vercel and GitHub (required and optional), how staging access is locked, how uploads and downloads work within Vercel's limits, the migration process, how to create the first admin securely, and the optional labeled demo content.

In short:

1. Create a Supabase project, then paste `supabase/setup.sql` into its SQL Editor and run it once. Migrations never run inside Vercel functions.
2. Import the repository into Vercel. `vercel.json` sets the build, the API function, the daily maintenance job and security headers. Add the required variables. If any is missing, the API answers "not fully configured" and the function logs list exactly what.
3. Sign up, then claim the admin role at `/#admin-setup` with `ADMIN_BOOTSTRAP_TOKEN` (remove it afterwards).
4. Add the webhook addresses above in Stripe, Resend and Mux.
5. Test a full order with a Stripe test card. Live payments are always blocked on staging.

`GET /api/health` reports the database, whether its migrations are current, and each integration. It returns 503 if the database is unreachable or behind.

The earlier Render plan (`render.yaml`, Neon, Cloudflare R2) is obsolete and was removed.

## Marketing, reviews and content

Owner managed announcement bars, promotional strips and image banners; a resource quiz and a Nurse Kin invitation, opened from two small buttons in the corner (never automatically); verified purchase reviews with moderation; the Our Story page; and watermarked, owner approved sample previews on product pages. See **OWNER_GUIDE.md**. A banner never creates a discount: coupon codes are shown only after they are checked against a real Stripe promotion code.

## Where things live

```
server/            API server
  db/migrations/   Database schema
  services/        Business rules (entitlements.ts has the download rule)
  routes/          Public, account, admin and webhook endpoints
  serverless.ts    The API as a Vercel Function (api/index.ts loads it)
api/index.ts       Vercel Function entry
middleware.ts      Staging password in front of every page on Vercel
vercel.json        Vercel build, routing, daily job and security headers
  tests/           Automated tests
shared/            Code used by both the browser and the server
src/               Storefront, customer dashboard and admin dashboard
  pages/account/   Customer dashboard
  pages/admin/     Admin dashboard
```
