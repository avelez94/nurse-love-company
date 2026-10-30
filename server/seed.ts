/*
  Labeled demo content.

  * Local development: loaded automatically into an empty database, including
    two local only sign ins (documented in the README).
  * Staging: only when DEMO_CONTENT=true AND DEPLOY_ENV=staging, and only when
    an admin presses "Load demo content" (or runs npm run seed on the server).
    Staging never gets an admin account or any password anyone knows: demo
    customers get random passwords and undeliverable @demo.invalid addresses.
  * Production: never.

  Every product and order is flagged is_demo and labeled "Demo". Demo orders
  have no payment reference and can't be refunded through Stripe, and emails
  about demo content are recorded but never sent. Running it again adds only
  what is missing: products are keyed by slug, orders by a stable demo_key,
  and the whole run holds a database lock so two clicks can't race.
*/
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { PoolClient } from 'pg'
import { auth, type SessionUser } from './auth.js'
import { db, one, q } from './db/pool.js'
import { demoAllowed, deployEnv } from './env.js'
import { audit } from './lib/audit.js'
import { badRequest, notFound } from './lib/errors.js'
import { storage } from './lib/storage.js'
import { grantPurchaseEntitlements, publishRelease } from './services/entitlements.js'
import { buildSamplePlannerPdf } from '../shared/samplePdf.js'
import { docFromList, docFromParagraphs } from '../shared/richtext.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Local development only. Never created on staging or production. */
export const DEV_ADMIN = { email: 'owner@nurselove.test', password: 'NurseLoveAdmin1!', name: 'Store Owner (local demo)' }
export const DEV_CUSTOMER = { email: 'demo.customer@nurselove.test', password: 'NurseLoveDemo1!', name: 'Jordan Rivera (demo)' }

const demoShoppers = [
  { key: 'jordan', name: 'Jordan Rivera (demo)' },
  { key: 'sam', name: 'Sam Lee (demo)' },
  { key: 'alex', name: 'Alex Morgan (demo)' },
  { key: 'taylor', name: 'Taylor Brooks (demo)' },
]

const digital = [
  { slug: 'dermatology-documentation', title: 'Dermatology Documentation', category: 'nurse-inserts', price: 900, summary: 'Example insert topic for organizing your dermatology notes.' },
  { slug: 'sickle-cell', title: 'Sickle Cell', category: 'nurse-inserts', price: 900, summary: 'Example insert topic for building your sickle cell study notes.' },
  { slug: 'glaucoma', title: 'Glaucoma', category: 'nurse-inserts', price: 900, summary: 'Example insert topic for organizing your glaucoma study notes.' },
  { slug: 'nurse-report-sheet', title: 'Nurse Report Pages', category: 'nurse-inserts', price: 700, summary: 'Example layout pages for keeping your shift notes tidy.' },
  { slug: 'daily-brain-dump', title: 'Daily Brain Dump', category: 'nurse-inserts', price: 500, summary: 'Example planner pages for clearing your head before a busy day.' },
  { slug: 'np-assessment-pages', title: 'Assessment Pages', category: 'np-inserts', price: 1200, summary: 'Example NP insert layout for organizing assessment notes.' },
  { slug: 'np-care-plan-pages', title: 'Care Plan Pages', category: 'np-inserts', price: 1200, summary: 'Example NP insert layout with space to plan and review.' },
  { slug: 'np-clinical-rotation-log', title: 'Clinical Rotation Log', category: 'np-inserts', price: 1000, summary: 'Example NP insert layout for tracking rotation days and reflections.' },
]

const physical = [
  { slug: 'nurse-love-tee', title: 'Nurse Love Tee', category: 'apparel', price: 2600, summary: 'Example listing for a soft pink tee with the Nurse Love script.', variants: [['S', 6], ['M', 2], ['L', 9], ['XL', 0]] as Array<[string, number]> },
  { slug: 'nurse-love-crewneck', title: 'Nurse Love Crewneck', category: 'apparel', price: 3800, summary: 'Example listing for a cozy crewneck for off-duty days.', variants: [['S', 4], ['M', 5], ['L', 3]] as Array<[string, number]> },
  { slug: 'heart-drop-earrings', title: 'Heart Drop Earrings', category: 'accessories', price: 1800, summary: 'Example listing for a simple pair of pink heart earrings.', stock: 12 },
  { slug: 'heart-stud-earrings', title: 'Heart Stud Earrings', category: 'accessories', price: 1400, summary: 'Example listing for tiny heart studs for every day.', stock: 2 },
  { slug: 'heart-badge-reel', title: 'Heart Badge Reel', category: 'accessories', price: 1200, summary: 'Example listing for a sweet badge reel for your work badge.', stock: 20 },
  { slug: 'pretty-pen-pair', title: 'Pretty Pen Pair', category: 'pens', price: 900, summary: 'Example listing for two pink pens with gold accents.', stock: 30 },
  { slug: 'pretty-pen-trio', title: 'Pretty Pen Trio', category: 'pens', price: 1300, summary: 'Example listing for a trio of soft pink pens.', stock: 3 },
]

interface Plan {
  key: string
  days: number
  items: string[]
  status?: 'paid' | 'refunded' | 'partially_refunded'
  fulfill?: boolean
}

/** Orders for the four demo shoppers (index into demoShoppers). */
const shopperPlans: Array<Plan & { who: number }> = [
  { key: 'o01', who: 0, days: 52, items: ['np-assessment-pages', 'pretty-pen-pair'], fulfill: true },
  { key: 'o02', who: 0, days: 20, items: ['np-care-plan-pages'] },
  { key: 'o03', who: 0, days: 3, items: ['np-clinical-rotation-log', 'nurse-love-tee:M'] },
  { key: 'o04', who: 1, days: 45, items: ['glaucoma', 'sickle-cell'] },
  { key: 'o05', who: 1, days: 9, items: ['heart-drop-earrings', 'dermatology-documentation'], fulfill: true },
  { key: 'o06', who: 2, days: 33, items: ['nurse-report-sheet', 'daily-brain-dump', 'heart-badge-reel'], fulfill: true },
  { key: 'o07', who: 2, days: 14, items: ['nurse-love-crewneck:L'], status: 'refunded' },
  { key: 'o08', who: 3, days: 6, items: ['np-assessment-pages', 'np-care-plan-pages'] },
  { key: 'o09', who: 3, days: 1, items: ['pretty-pen-trio', 'heart-stud-earrings'] },
  { key: 'o10', who: 1, days: 27, items: ['daily-brain-dump'], status: 'partially_refunded' },
]

/** Orders attached to a reviewer's own account so they can see the customer dashboard. */
const reviewerPlans: Plan[] = [
  { key: 'r1', days: 40, items: ['np-assessment-pages', 'pretty-pen-pair'], fulfill: true },
  { key: 'r2', days: 18, items: ['np-care-plan-pages'] },
  { key: 'r3', days: 2, items: ['np-clinical-rotation-log', 'nurse-love-tee:M'] },
]

const system: SessionUser = { id: 'demo-seed', email: 'demo content loader', name: 'Demo content', role: 'admin' }

async function storeBytes(key: string, bytes: Uint8Array, type: string) {
  return storage().put(key, Readable.from([Buffer.from(bytes)], { objectMode: false }), type, 50 * 1024 * 1024)
}

async function ensureUser(email: string, name: string, password: string, role: 'admin' | 'customer') {
  let u = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [email])
  if (!u) {
    await auth().api.signUpEmail({ body: { email, password, name } })
    u = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [email])
    await q('update "user" set role = $2, "emailVerified" = true where id = $1', [u!.id, role])
  }
  return u!.id
}

export async function seedIfEmpty() {
  if (deployEnv !== 'development') return
  if (await one('select 1 from products limit 1')) return
  console.log('[seed] creating labeled demo data')
  await seedDemoContent({})
  console.log(`[seed] local admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`)
  console.log(`[seed] local customer: ${DEV_CUSTOMER.email} / ${DEV_CUSTOMER.password}`)
}

export interface SeedResult {
  productsCreated: number
  ordersCreated: number
  reviewerOrdersCreated: number
  tutorialsCreated: number
}

/**
 * Adds any missing demo content. Safe to run any number of times.
 * reviewerEmail: an existing account that should also receive demo orders.
 */
export async function seedDemoContent(opts: { reviewerEmail?: string | null; actor?: SessionUser | null }): Promise<SeedResult> {
  if (!demoAllowed()) throw badRequest('Demo content is switched off. It is only available on staging with DEMO_CONTENT=true.')
  // A transaction level lock held by an open transaction works through
  // Supabase's transaction pooler too (session locks would not).
  const lockClient = await db().connect()
  try {
    await lockClient.query('begin')
    await lockClient.query('select pg_advisory_xact_lock(727002)')
    const result = await run(opts)
    if (opts.actor) {
      await audit({ actor: opts.actor, action: 'demo.loaded', entityType: 'demo', summary: `Loaded labeled demo content: ${result.productsCreated} products, ${result.ordersCreated + result.reviewerOrdersCreated} orders and ${result.tutorialsCreated} tutorials added${opts.reviewerEmail ? `, demo orders for ${opts.reviewerEmail}` : ''}. Nothing already present was duplicated.` })
    }
    return result
  } finally {
    await lockClient.query('commit').catch(() => {})
    lockClient.release()
  }
}

async function run(opts: { reviewerEmail?: string | null }): Promise<SeedResult> {
  const result: SeedResult = { productsCreated: 0, ordersCreated: 0, reviewerOrdersCreated: 0, tutorialsCreated: 0 }
  const local = deployEnv === 'development'

  let reviewerId: string | null = null
  if (opts.reviewerEmail) {
    const r = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [opts.reviewerEmail])
    if (!r) throw notFound(`An account for ${opts.reviewerEmail}`)
    reviewerId = r.id
  }

  // Accounts. Only local development gets sign ins with known passwords.
  if (local) await ensureUser(DEV_ADMIN.email, DEV_ADMIN.name, DEV_ADMIN.password, 'admin')
  const shopperIds: string[] = []
  const shopperEmails: string[] = []
  for (const [i, s] of demoShoppers.entries()) {
    const email = local && i === 0 ? DEV_CUSTOMER.email : `${s.key}@demo.invalid`
    const password = local && i === 0 ? DEV_CUSTOMER.password : `${randomBytes(24).toString('base64url')}Aa1!`
    shopperIds.push(await ensureUser(email, s.name, password, 'customer'))
    shopperEmails.push(email)
  }

  // Products, keyed by slug.
  for (const [i, d] of digital.entries()) {
    const created = await one<{ id: string }>(
      `insert into products (slug, title, category, collection, type, short_description, description, price_cents, status, active, is_demo, sort_order, page_size, orientation, file_format, show_binder_notice, published_at)
       values ($1,$2,$3,$4,'digital',$5,$6,$7,'published',true,true,$8,'US Letter (8.5 × 11 in)','portrait','PDF',true, now())
       on conflict (slug) do nothing returning id`,
      [d.slug, d.title, d.category, d.category === 'np-inserts' ? 'NP Binder Inserts' : 'Nurse Binder Inserts', d.summary, JSON.stringify(docFromParagraphs(['This is a demo listing that shows how the resource will be presented. The final description, included pages and file details will be added by Nurse Love Company.'])), d.price, i],
    )
    if (!created) continue
    result.productsCreated++
    const pdf = buildSamplePlannerPdf(d.title, 'Demo prototype file for the preview. Not a finished Nurse Love Company resource.')
    const stored = await storeBytes(`product-files/${created.id}/demo-v1.pdf`, pdf, 'application/pdf')
    const v = await one<{ id: string }>(
      `insert into product_versions (product_id, version_number, storage_key, file_name, content_type, file_size, sha256, notes, released_by) values ($1,1,$2,$3,'application/pdf',$4,$5,'Initial demo file.','demo content') returning id`,
      [created.id, stored.key, `${d.slug}-demo.pdf`, stored.size, stored.sha256],
    )
    await q('update products set current_version_id = $2 where id = $1', [created.id, v!.id])
  }
  for (const [i, p] of physical.entries()) {
    const created = await one<{ id: string }>(
      `insert into products (slug, title, category, collection, type, short_description, description, price_cents, status, active, is_demo, sort_order, inventory_quantity, low_stock_threshold, shipping_info, weight_grams, published_at)
       values ($1,$2,$3,'','physical',$4,$5,$6,'published',true,true,$7,$8,3,'Shipping details will be added before launch.',$9, now())
       on conflict (slug) do nothing returning id`,
      [p.slug, p.title, p.category, p.summary, JSON.stringify(docFromParagraphs(['This is a demo listing. Photos, sizes, colors and shipping details will be added by Nurse Love Company.'])), p.price, 100 + i, p.stock ?? 0, p.category === 'apparel' ? 250 : 40],
    )
    if (!created) continue
    result.productsCreated++
    for (const [j, [size, stock]] of (p.variants ?? []).entries()) {
      await q(`insert into product_variants (product_id, title, options, inventory_quantity, sort_order) values ($1,$2,$3,$4,$5)`, [created.id, `${size} / Pink`, JSON.stringify({ size, color: 'Pink' }), stock, j])
    }
  }
  const draft = await one(
    `insert into products (slug, title, category, type, short_description, description, status, active, is_demo) values ('weekly-study-planner-draft','Weekly Study Planner (draft)','nurse-inserts','digital','Draft example. Not visible in the shop.',$1,'draft',true,true)
     on conflict (slug) do nothing returning id`,
    [JSON.stringify(docFromParagraphs(['Draft listing.']))],
  )
  if (draft) result.productsCreated++

  // Demo shopper orders, keyed by demo_key.
  for (const plan of shopperPlans) {
    const id = await createOrder(`shopper:${plan.key}`, plan, shopperIds[plan.who], demoShoppers[plan.who].name, shopperEmails[plan.who])
    if (!id) continue
    result.ordersCreated++
    // Jordan has already used one download, to show "Download used".
    if (plan.key === 'o01') await q(`update entitlements e set status = 'redeemed', redeemed_at = now() - interval '40 days' from order_items oi where oi.id = e.order_item_id and oi.order_id = $1 and e.status = 'available'`, [id])
    if (plan.key === 'o02') await q(`update entitlements e set status = 'redeemed', redeemed_at = now() - interval '15 days' from order_items oi where oi.id = e.order_item_id and oi.order_id = $1 and e.status = 'available'`, [id])
  }

  // A version 2 release of Care Plan Pages, once, to show product updates.
  const carePlan = await one<{ id: string; is_demo: boolean }>(`select id, is_demo from products where slug = 'np-care-plan-pages'`)
  const released = await one(`select 1 from product_releases where idempotency_key = 'demo-release-care-plan-v2'`)
  if (carePlan?.is_demo && !released) {
    const pdf2 = buildSamplePlannerPdf('Care Plan Pages v2', 'Demo prototype file, version 2. Not a finished Nurse Love Company resource.')
    const st2 = await storeBytes(`product-files/${carePlan.id}/demo-v2.pdf`, pdf2, 'application/pdf')
    const up = await one<{ id: string }>(
      `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256, uploaded_by) values ($1,$2,'np-care-plan-pages-demo-v2.pdf','application/pdf',$3,$4,'demo content') returning id`,
      [carePlan.id, st2.key, st2.size, st2.sha256],
    )
    await publishRelease({ productId: carePlan.id, uploadId: up!.id, notes: 'Demo update: refreshed layout (sample notes).', notify: false, idempotencyKey: 'demo-release-care-plan-v2', actor: system })
  }

  // Demo orders on the reviewer's own account (their own password; nothing shared).
  if (reviewerId) {
    const reviewer = await one<{ name: string; email: string }>('select name, email from "user" where id = $1', [reviewerId])
    for (const plan of reviewerPlans) {
      const id = await createOrder(`reviewer:${reviewerId}:${plan.key}`, plan, reviewerId, reviewer!.name, reviewer!.email, plan.key === 'r2' ? showUpdate : undefined)
      if (!id) continue
      result.reviewerOrdersCreated++
      if (plan.key === 'r1') await q(`update entitlements e set status = 'redeemed', redeemed_at = now() - interval '30 days' from order_items oi where oi.id = e.order_item_id and oi.order_id = $1 and e.status = 'available'`, [id])
    }
  }

  result.tutorialsCreated += await seedTutorials()

  await q(`insert into app_settings (key, value, updated_by) values ('freebies', $1, 'demo content') on conflict (key) do nothing`, [JSON.stringify({ items: [{ id: 'daily-planner-sample', title: 'Daily Planner Page', summary: 'A general planner page with a top 3, schedule and notes. Prototype sample.', published: true }] })])
  const featured = await q<{ id: string }>(`select id from products where slug in ('np-assessment-pages','nurse-love-tee') and is_demo`)
  await q(`insert into app_settings (key, value, updated_by) values ('homepage', $1, 'demo content') on conflict (key) do nothing`, [JSON.stringify({ featured_product_ids: featured.map((f) => f.id) })])
  return result
}

/** Gives a reviewer's Care Plan order a used v1 download plus one new v2 download. */
async function showUpdate(client: PoolClient, orderId: string, userId: string) {
  const item = await one<{ id: string; product_id: string }>(`select oi.id, oi.product_id from order_items oi where oi.order_id = $1 and oi.product_type = 'digital'`, [orderId], client)
  if (!item) return
  const v1 = await one<{ id: string }>('select id from product_versions where product_id = $1 and version_number = 1', [item.product_id], client)
  const latest = await one<{ id: string; release_id: string | null }>(`select v.id, r.id as release_id from products p join product_versions v on v.id = p.current_version_id left join product_releases r on r.version_id = v.id where p.id = $1`, [item.product_id], client)
  if (!v1 || !latest || latest.id === v1.id) return
  await q(`insert into entitlements (user_id, product_id, order_item_id, version_id, source, status, redeemed_at) values ($1,$2,$3,$4,'purchase','redeemed', now() - interval '12 days')`, [userId, item.product_id, item.id, v1.id], client)
  await q(`insert into entitlements (user_id, product_id, order_item_id, version_id, source, release_id) values ($1,$2,$3,$4,'update',$5)`, [userId, item.product_id, item.id, latest.id, latest.release_id], client)
}

/** Creates one labeled demo order unless its demo_key already exists. Returns the new id, or null. */
async function createOrder(demoKey: string, plan: Plan, userId: string, name: string, email: string, before?: (client: PoolClient, orderId: string, userId: string) => Promise<void>) {
  const client = await db().connect()
  try {
    await client.query('begin')
    const paidAt = new Date(Date.now() - plan.days * 86400000)
    const lines: Array<{ id: string; type: string; title: string; variantId: string | null; variant: string; price: number; category: string }> = []
    for (const spec of plan.items) {
      const [slug, size] = spec.split(':')
      const p = await one<{ id: string; type: string; title: string; price_cents: number; category: string }>('select id, type, title, price_cents, category from products where slug = $1 and is_demo', [slug], client)
      if (!p) continue // a real product now uses this slug; skip rather than touch it
      let variantId: string | null = null
      let variant = ''
      if (size) {
        const v = await one<{ id: string; title: string }>(`select id, title from product_variants where product_id = $1 and options->>'size' = $2`, [p.id, size], client)
        variantId = v?.id ?? null
        variant = v?.title ?? ''
      }
      lines.push({ id: p.id, type: p.type, title: p.title, variantId, variant, price: p.price_cents, category: p.category })
    }
    if (!lines.length) {
      await client.query('rollback')
      return null
    }
    const subtotal = lines.reduce((n, l) => n + l.price, 0)
    const hasPhysical = lines.some((l) => l.type === 'physical')
    const shipping = hasPhysical ? 500 : 0
    const tax = Math.round(subtotal * 0.06)
    const total = subtotal + shipping + tax
    const status = plan.status ?? 'paid'
    const address = { line1: '100 Demo Street', city: 'Sampletown', state: 'NC', postal_code: '27601', country: 'US' }
    const o = await one<{ id: string }>(
      `insert into orders (user_id, email, customer_name, status, fulfillment_status, subtotal_cents, shipping_cents, tax_cents, total_cents, fee_cents, refunded_cents, billing_details, shipping_address, is_demo, demo_key, created_at, paid_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10,$11,$12,true,$13,$14,$14)
       on conflict (demo_key) where demo_key is not null do nothing returning id`,
      [
        userId, email, name, status,
        hasPhysical ? (plan.fulfill ? 'fulfilled' : 'unfulfilled') : 'not_required',
        subtotal, shipping, tax, total,
        status === 'refunded' ? total : status === 'partially_refunded' ? Math.round(total / 2) : 0,
        JSON.stringify({ name, email, address }),
        hasPhysical ? JSON.stringify({ name, address }) : null,
        demoKey,
        paidAt.toISOString(),
      ],
      client,
    )
    if (!o) {
      await client.query('rollback')
      return null
    }
    for (const l of lines) {
      await q(
        `insert into order_items (order_id, product_id, variant_id, product_type, title_snapshot, variant_snapshot, category_snapshot, unit_price_cents, quantity, line_total_cents, refunded_quantity) values ($1,$2,$3,$4,$5,$6,$7,$8,1,$8,$9)`,
        [o.id, l.id, l.variantId, l.type, l.title, l.variant, l.category, l.price, status === 'refunded' ? 1 : 0],
        client,
      )
    }
    if (status !== 'paid') await q(`insert into refunds (order_id, amount_cents, reason, status, created_by, created_at) values ($1,$2,'Demo refund','succeeded','demo content',$3)`, [o.id, status === 'refunded' ? total : Math.round(total / 2), new Date(paidAt.getTime() + 86400000).toISOString()], client)
    if (plan.fulfill) await q(`insert into shipments (order_id, carrier, tracking_number, status, shipped_at, created_by) values ($1,'USPS','DEMO-TRACKING-0000','delivered',$2,'demo content')`, [o.id, new Date(paidAt.getTime() + 2 * 86400000).toISOString()], client)
    await q(`insert into order_updates (order_id, message, created_by, created_at) values ($1,'Demo order: sample data, no payment was taken.','demo content',$2)`, [o.id, paidAt.toISOString()], client)
    if (before) await before(client, o.id, userId)
    await grantPurchaseEntitlements(o.id, client)
    await client.query('commit')
    return o.id
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function seedTutorials() {
  let created = 0
  const tut = await one<{ id: string }>(
    `insert into tutorials (slug, title, category, summary, instructions, transcript, status, featured, display_order, video_provider, video_status, duration_seconds, is_placeholder, created_by, published_at)
     values ('how-to-put-together-your-np-binder','How to Put Together Your NP Binder','np-binder',$1,$2,'','published', true, 0, 'local', 'ready', 18, true, 'demo content', now())
     on conflict (slug) do nothing returning id`,
    [
      "Placeholder tutorial. The owner's real video will replace this short placeholder.",
      JSON.stringify(
        docFromList([
          'Sample step: choose the NP Binder Inserts you want to use and save the files somewhere easy to find.',
          'Sample step: check each resource page for its confirmed format and printing details.',
          'Sample step: print the pages you need and hole punch them to match your own binder. A binder is not included with digital purchases.',
        ]),
      ),
    ],
  )
  if (tut) {
    created++
    const assets = join(here, '..', 'src', 'assets', 'tutorials')
    const vk = await storeBytes(`tutorial-videos/${tut.id}/placeholder/video.mp4`, readFileSync(join(assets, 'placeholder.mp4')), 'video/mp4')
    const pk = await storeBytes(`tutorial-videos/${tut.id}/placeholder/poster.jpg`, readFileSync(join(assets, 'placeholder-poster.jpg')), 'image/jpeg')
    await q('update tutorials set video_key = $2, poster_key = $3 where id = $1', [tut.id, vk.key, pk.key])
    await q(`insert into tutorial_captions (tutorial_id, label, srclang, vtt) values ($1,'English','en',$2) on conflict do nothing`, [tut.id, readFileSync(join(assets, 'placeholder.en.vtt'), 'utf8')])
    await q(`insert into tutorial_products (tutorial_id, product_id) select $1, id from products where slug in ('np-assessment-pages','np-care-plan-pages') and is_demo on conflict do nothing`, [tut.id])
  }
  const draft = await one(
    `insert into tutorials (slug, title, category, summary, instructions, status, display_order, created_by)
     values ('printing-your-inserts-at-home','Printing Your Inserts at Home','printing-assembly','Draft example with no video yet. Drafts never appear publicly.',$1,'draft',1,'demo content')
     on conflict (slug) do nothing returning id`,
    [JSON.stringify(docFromParagraphs(['Draft instructions go here.']))],
  )
  if (draft) created++
  return created
}

/** What demo content exists, for the admin settings page. */
export async function demoSummary() {
  return one<{ products: number; orders: number }>(`select (select count(*) from products where is_demo)::int as products, (select count(*) from orders where is_demo)::int as orders`)
}
