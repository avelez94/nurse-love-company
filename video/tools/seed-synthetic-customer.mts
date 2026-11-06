// Adds a synthetic customer purchase to a LOCAL database for tutorial screenshots.
// Never run against production. See video/README.md, "Capturing screens".
// First sign up Sam Taylor (sam.taylor@example.com) on the local site, then:
//   npx tsx video/tools/seed-synthetic-customer.mts   (from the repo root, with the local DATABASE_URL)
import { Readable } from 'node:stream'
import { boot } from '../../server/boot.ts'
import { one, q, tx } from '../../server/db/pool.ts'
import { storage } from '../../server/lib/storage.ts'
import { grantPurchaseEntitlements } from '../../server/services/entitlements.ts'
import { buildSamplePlannerPdf } from '../../shared/samplePdf.ts'

const pool = await boot()
const user = (await one<{ id: string }>(`select id from "user" where email = 'sam.taylor@example.com'`))!
const p = (await one<{ id: string }>(
  `insert into products (slug, title, category, type, price_cents, status, active, show_binder_notice, short_description, published_at)
   values ('sample-study-insert','Sample Study Insert','nurse-inserts','digital',800,'published',true,true,'A sample printable used in our how to videos.', now()) returning id`))!
const pdf = buildSamplePlannerPdf('Sample Study Insert', 'Sample file for the Nurse Love Company how to videos.')
const stored = await storage().put(`product-files/${p.id}/v1.pdf`, Readable.from([Buffer.from(pdf)], { objectMode: false }), 'application/pdf', 10_000_000)
const v = (await one<{ id: string }>(
  `insert into product_versions (product_id, version_number, storage_key, file_name, content_type, file_size, sha256) values ($1,1,$2,'Sample-Study-Insert.pdf','application/pdf',$3,$4) returning id`,
  [p.id, stored.key, stored.size, stored.sha256]))!
await q('update products set current_version_id = $2 where id = $1', [p.id, v.id])
await tx(async (client) => {
  const o = (await one<{ id: string }>(
    `insert into orders (user_id, email, customer_name, status, subtotal_cents, total_cents, paid_at) values ($1,'sam.taylor@example.com','Sam Taylor','paid',800,800, now()) returning id`, [user.id], client))!
  await q(`insert into order_items (order_id, product_id, product_type, title_snapshot, category_snapshot, unit_price_cents, quantity, line_total_cents) values ($1,$2,'digital','Sample Study Insert','nurse-inserts',800,1,800)`, [o.id, p.id], client)
  await grantPurchaseEntitlements(o.id, client)
})
console.log((await q(`select status from entitlements`)).map((r: any) => r.status), (await one<any>('select order_number from orders')).order_number)
await pool.end()
