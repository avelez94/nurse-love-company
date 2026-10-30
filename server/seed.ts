/*
  Demonstration data for local previews. Every product and order created here
  is flagged is_demo = true and labeled "Demo" throughout the admin and the
  storefront. Demo prices are placeholders, not approved prices. Demo files are
  generic prototype PDFs, not Nurse Love Company resources.
  Never runs in production.
*/
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { auth } from './auth.js'
import { one, q, tx } from './db/pool.js'
import { isProduction } from './env.js'
import { storage } from './lib/storage.js'
import { grantPurchaseEntitlements, publishRelease } from './services/entitlements.js'
import { buildSamplePlannerPdf } from '../shared/samplePdf.js'
import { docFromList, docFromParagraphs } from '../shared/richtext.js'

const here = dirname(fileURLToPath(import.meta.url))

export const DEMO_ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? 'owner@nurselove.test', password: process.env.SEED_ADMIN_PASSWORD ?? 'NurseLoveAdmin1!', name: 'Store Owner (demo)' }
export const DEMO_CUSTOMER = { email: 'demo.customer@nurselove.test', password: 'NurseLoveDemo1!', name: 'Jordan Rivera (demo)' }

const otherCustomers = [
  { email: 'sam.lee@nurselove.test', name: 'Sam Lee (demo)' },
  { email: 'alex.morgan@nurselove.test', name: 'Alex Morgan (demo)' },
  { email: 'taylor.brooks@nurselove.test', name: 'Taylor Brooks (demo)' },
]

async function ensureUser(email: string, name: string, password: string, role: 'admin' | 'customer') {
  let u = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [email])
  if (!u) {
    await auth().api.signUpEmail({ body: { email, password, name } })
    u = await one<{ id: string }>('select id from "user" where lower(email) = lower($1)', [email])
  }
  await q('update "user" set role = $2, "emailVerified" = true where id = $1', [u!.id, role])
  return u!.id
}

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

const descriptionNote = 'This is a demo listing that shows how the resource will be presented. The final description, included pages and file details will be added by Nurse Love Company.'

async function storeBytes(key: string, bytes: Uint8Array, type: string) {
  return storage().put(key, Readable.from([Buffer.from(bytes)], { objectMode: false }), type, 50 * 1024 * 1024)
}

export async function seedIfEmpty() {
  if (isProduction) return
  const has = await one('select 1 from products limit 1')
  if (has) return
  console.log('[seed] creating labeled demo data')
  await seed()
}

export async function seed() {
  const adminId = await ensureUser(DEMO_ADMIN.email, DEMO_ADMIN.name, DEMO_ADMIN.password, 'admin')
  const admin = { id: adminId, email: DEMO_ADMIN.email, name: DEMO_ADMIN.name, role: 'admin' as const }
  const demoId = await ensureUser(DEMO_CUSTOMER.email, DEMO_CUSTOMER.name, DEMO_CUSTOMER.password, 'customer')
  const others: string[] = []
  for (const o of otherCustomers) others.push(await ensureUser(o.email, o.name, `Demo-${Math.random().toString(36).slice(2)}-Pass1`, 'customer'))

  const productIds: Record<string, string> = {}
  for (const [i, d] of digital.entries()) {
    const row = await one<{ id: string }>(
      `insert into products (slug, title, category, collection, type, short_description, description, price_cents, status, active, is_demo, sort_order, page_size, orientation, file_format, show_binder_notice, published_at)
       values ($1,$2,$3,$4,'digital',$5,$6,$7,'published',true,true,$8,'US Letter (8.5 × 11 in)','portrait','PDF',true, now()) returning id`,
      [d.slug, d.title, d.category, d.category === 'np-inserts' ? 'NP Binder Inserts' : 'Nurse Binder Inserts', d.summary, JSON.stringify(docFromParagraphs([descriptionNote])), d.price, i],
    )
    productIds[d.slug] = row!.id
    const pdf = buildSamplePlannerPdf(`${d.title}`, 'Demo prototype file for the preview. Not a finished Nurse Love Company resource.')
    const stored = await storeBytes(`product-files/${row!.id}/demo-v1.pdf`, pdf, 'application/pdf')
    const v = await one<{ id: string }>(
      `insert into product_versions (product_id, version_number, storage_key, file_name, content_type, file_size, sha256, notes, released_by) values ($1,1,$2,$3,'application/pdf',$4,$5,'Initial demo file.','seed') returning id`,
      [row!.id, stored.key, `${d.slug}-demo.pdf`, stored.size, stored.sha256],
    )
    await q('update products set current_version_id = $2 where id = $1', [row!.id, v!.id])
  }

  for (const [i, p] of physical.entries()) {
    const row = await one<{ id: string }>(
      `insert into products (slug, title, category, collection, type, short_description, description, price_cents, status, active, is_demo, sort_order, inventory_quantity, low_stock_threshold, shipping_info, weight_grams, published_at)
       values ($1,$2,$3,'','physical',$4,$5,$6,'published',true,true,$7,$8,3,'Shipping details will be added before launch.',$9, now()) returning id`,
      [p.slug, p.title, p.category, p.summary, JSON.stringify(docFromParagraphs(['This is a demo listing. Photos, sizes, colors and shipping details will be added by Nurse Love Company.'])), p.price, 100 + i, p.stock ?? 0, p.category === 'apparel' ? 250 : 40],
    )
    productIds[p.slug] = row!.id
    for (const [j, [size, stock]] of (p.variants ?? []).entries()) {
      await q(`insert into product_variants (product_id, title, options, inventory_quantity, sort_order) values ($1,$2,$3,$4,$5)`, [row!.id, `${size} / Pink`, JSON.stringify({ size, color: 'Pink' }), stock, j])
    }
  }

  // A draft product, to show that drafts stay off the storefront.
  await q(
    `insert into products (slug, title, category, type, short_description, description, status, active, is_demo) values ('weekly-study-planner-draft','Weekly Study Planner (draft)','nurse-inserts','digital','Draft example. Not visible in the shop.',$1,'draft',true,true)`,
    [JSON.stringify(docFromParagraphs(['Draft listing.']))],
  )

  // Demo orders spread over the last 60 days.
  const customers = [demoId, ...others]
  const names = [DEMO_CUSTOMER, ...otherCustomers]
  const plans: Array<{ who: number; days: number; items: string[]; status?: string; fulfill?: boolean }> = [
    { who: 0, days: 52, items: ['np-assessment-pages', 'pretty-pen-pair'], fulfill: true },
    { who: 0, days: 20, items: ['np-care-plan-pages'] },
    { who: 0, days: 3, items: ['np-clinical-rotation-log', 'nurse-love-tee:M'] },
    { who: 1, days: 45, items: ['glaucoma', 'sickle-cell'] },
    { who: 1, days: 9, items: ['heart-drop-earrings', 'dermatology-documentation'], fulfill: true },
    { who: 2, days: 33, items: ['nurse-report-sheet', 'daily-brain-dump', 'heart-badge-reel'], fulfill: true },
    { who: 2, days: 14, items: ['nurse-love-crewneck:L'], status: 'refunded' },
    { who: 3, days: 6, items: ['np-assessment-pages', 'np-care-plan-pages'] },
    { who: 3, days: 1, items: ['pretty-pen-trio', 'heart-stud-earrings'] },
    { who: 1, days: 27, items: ['daily-brain-dump'], status: 'partially_refunded' },
  ]
  for (const plan of plans) {
    const paidAt = new Date(Date.now() - plan.days * 86400000 - Math.floor(Math.random() * 6) * 3600000)
    await tx(async (client) => {
      const lines: Array<{ id: string; type: string; title: string; variantId: string | null; variant: string; price: number; category: string; qty: number }> = []
      for (const spec of plan.items) {
        const [slug, size] = spec.split(':')
        const p = await one<{ id: string; type: string; title: string; price_cents: number; category: string }>('select id, type, title, price_cents, category from products where slug = $1', [slug], client)
        let variantId: string | null = null
        let variant = ''
        if (size) {
          const v = await one<{ id: string; title: string }>(`select id, title from product_variants where product_id = $1 and options->>'size' = $2`, [p!.id, size], client)
          variantId = v!.id
          variant = v!.title
        }
        lines.push({ id: p!.id, type: p!.type, title: p!.title, variantId, variant, price: p!.price_cents, category: p!.category, qty: 1 })
      }
      const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0)
      const hasPhysical = lines.some((l) => l.type === 'physical')
      const shipping = hasPhysical ? 500 : 0
      const tax = Math.round(subtotal * 0.06)
      const total = subtotal + shipping + tax
      const status = plan.status ?? 'paid'
      const who = names[plan.who]
      const o = await one<{ id: string }>(
        `insert into orders (user_id, email, customer_name, status, fulfillment_status, subtotal_cents, shipping_cents, tax_cents, total_cents, fee_cents, refunded_cents, billing_details, shipping_address, is_demo, created_at, paid_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$14) returning id`,
        [
          customers[plan.who], who.email, who.name, status,
          hasPhysical ? (plan.fulfill ? 'fulfilled' : status === 'refunded' ? 'unfulfilled' : 'unfulfilled') : 'not_required',
          subtotal, shipping, tax, total, Math.round(total * 0.029) + 30,
          status === 'refunded' ? total : status === 'partially_refunded' ? Math.round(total / 2) : 0,
          JSON.stringify({ name: who.name, email: who.email, address: { line1: '100 Demo Street', city: 'Sampletown', state: 'NC', postal_code: '27601', country: 'US' } }),
          hasPhysical ? JSON.stringify({ name: who.name, address: { line1: '100 Demo Street', city: 'Sampletown', state: 'NC', postal_code: '27601', country: 'US' } }) : null,
          paidAt.toISOString(),
        ],
        client,
      )
      for (const l of lines) {
        await q(
          `insert into order_items (order_id, product_id, variant_id, product_type, title_snapshot, variant_snapshot, category_snapshot, unit_price_cents, quantity, line_total_cents, refunded_quantity)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [o!.id, l.id, l.variantId, l.type, l.title, l.variant, l.category, l.price, l.qty, l.price * l.qty, status === 'refunded' ? l.qty : 0],
          client,
        )
      }
      if (status === 'refunded' || status === 'partially_refunded') {
        await q(`insert into refunds (order_id, amount_cents, reason, status, created_by, created_at) values ($1,$2,'Demo refund','succeeded','seed',$3)`, [o!.id, status === 'refunded' ? total : Math.round(total / 2), new Date(paidAt.getTime() + 86400000).toISOString()], client)
      }
      if (plan.fulfill) await q(`insert into shipments (order_id, carrier, tracking_number, status, shipped_at, created_by) values ($1,'USPS','DEMO-TRACKING-0000','delivered',$2,'seed')`, [o!.id, new Date(paidAt.getTime() + 2 * 86400000).toISOString()], client)
      await q(`insert into order_updates (order_id, message, created_by, created_at) values ($1,'Payment received. Thank you for your order!','seed',$2)`, [o!.id, paidAt.toISOString()], client)
      await grantPurchaseEntitlements(o!.id, client)
    })
  }

  // Show a used download and an updated version on the demo customer's account.
  await q(
    `update entitlements set status = 'redeemed', redeemed_at = now() - interval '40 days'
      where user_id = $1 and product_id = $2`,
    [demoId, productIds['np-assessment-pages']],
  )
  const pdf2 = buildSamplePlannerPdf('Care Plan Pages v2', 'Demo prototype file, version 2. Not a finished Nurse Love Company resource.')
  const st2 = await storeBytes(`product-files/${productIds['np-care-plan-pages']}/demo-v2.pdf`, pdf2, 'application/pdf')
  const up = await one<{ id: string }>(
    `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256, uploaded_by) values ($1,$2,'np-care-plan-pages-demo-v2.pdf','application/pdf',$3,$4,'seed') returning id`,
    [productIds['np-care-plan-pages'], st2.key, st2.size, st2.sha256],
  )
  await q(`update entitlements set status = 'redeemed', redeemed_at = now() - interval '15 days' where user_id = $1 and product_id = $2`, [demoId, productIds['np-care-plan-pages']])
  await publishRelease({ productId: productIds['np-care-plan-pages'], uploadId: up!.id, notes: 'Demo update: refreshed layout (sample notes).', notify: false, idempotencyKey: 'seed-release-care-plan-v2', actor: admin })

  // Placeholder tutorial: clearly labeled, not the owner's recording.
  const tut = await one<{ id: string }>(
    `insert into tutorials (slug, title, category, summary, instructions, transcript, status, featured, display_order, video_provider, video_status, duration_seconds, is_placeholder, created_by, published_at)
     values ('how-to-put-together-your-np-binder','How to Put Together Your NP Binder','np-binder',$1,$2,'',
             'published', true, 0, 'local', 'ready', 18, true, 'seed', now()) returning id`,
    [
      'Placeholder tutorial. The owner\'s real video will replace this short placeholder.',
      JSON.stringify(
        docFromList([
          'Sample step: choose the NP Binder Inserts you want to use and save the files somewhere easy to find.',
          'Sample step: check each resource page for its confirmed format and printing details.',
          'Sample step: print the pages you need and hole punch them to match your own binder. A binder is not included with digital purchases.',
        ]),
      ),
    ],
  )
  const video = readFileSync(join(here, '..', 'src', 'assets', 'tutorials', 'placeholder.mp4'))
  const poster = readFileSync(join(here, '..', 'src', 'assets', 'tutorials', 'placeholder-poster.jpg'))
  const vtt = readFileSync(join(here, '..', 'src', 'assets', 'tutorials', 'placeholder.en.vtt'), 'utf8')
  const vk = await storeBytes(`tutorial-videos/${tut!.id}/placeholder/video.mp4`, video, 'video/mp4')
  const pk = await storeBytes(`tutorial-videos/${tut!.id}/placeholder/poster.jpg`, poster, 'image/jpeg')
  await q('update tutorials set video_key = $2, poster_key = $3 where id = $1', [tut!.id, vk.key, pk.key])
  await q(`insert into tutorial_captions (tutorial_id, label, srclang, vtt) values ($1,'English','en',$2)`, [tut!.id, vtt])
  for (const slug of ['np-assessment-pages', 'np-care-plan-pages']) await q('insert into tutorial_products values ($1,$2)', [tut!.id, productIds[slug]])

  await q(
    `insert into tutorials (slug, title, category, summary, instructions, status, display_order, created_by)
     values ('printing-your-inserts-at-home','Printing Your Inserts at Home','printing-assembly','Draft example with no video yet. Drafts never appear publicly.',$1,'draft',1,'seed')`,
    [JSON.stringify(docFromParagraphs(['Draft instructions go here.']))],
  )

  await q(
    `insert into app_settings (key, value, updated_by) values ('freebies', $1, 'seed') on conflict (key) do nothing`,
    [JSON.stringify({ items: [{ id: 'daily-planner-sample', title: 'Daily Planner Page', summary: 'A general planner page with a top 3, schedule and notes. Prototype sample.', published: true }] })],
  )
  await q(`insert into app_settings (key, value, updated_by) values ('homepage', $1, 'seed') on conflict (key) do nothing`, [JSON.stringify({ featured_product_ids: [productIds['np-assessment-pages'], productIds['nurse-love-tee']] })])

  console.log(`[seed] admin: ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}`)
  console.log(`[seed] customer: ${DEMO_CUSTOMER.email} / ${DEMO_CUSTOMER.password}`)
}
