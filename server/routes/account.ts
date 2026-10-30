import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { one, q, tx } from '../db/pool.js'
import { config } from '../env.js'
import { escapeHtml } from '../email/templates.js'
import { clientIp, jsonBody, requireUser, type AppEnv } from '../http.js'
import { badRequest, HttpError, notFound } from '../lib/errors.js'
import { rateLimit } from '../lib/rate-limit.js'
import { toWebBody } from '../lib/stream.js'
import { bool, str, uuid } from '../lib/validate.js'
import { listDownloads, prepareDownload, reportProblem, startDelivery } from '../services/entitlements.js'
import { createCheckout, money, priceCart, type CartLine } from '../services/orders.js'
import { marketingStatus, setAccountMarketing } from '../services/consent.js'

export const accountRoutes = new Hono<AppEnv>()

/* Customers only ever see their own records: every query filters by the session user id. */

accountRoutes.get('/account/me', async (c) => {
  const user = requireUser(c)
  const prefs = await one(`select order_updates, product_updates, marketing, download_reminders, review_requests from customer_profiles where user_id = $1`, [user.id])
  const addresses = await q(`select id, name, line1, line2, city, region, postal_code, country, phone, is_default from addresses where user_id = $1 order by is_default desc, created_at`, [user.id])
  return c.json({ user, preferences: prefs ?? { order_updates: true, product_updates: true, marketing: false, download_reminders: true, review_requests: true }, addresses })
})

accountRoutes.patch('/account/profile', async (c) => {
  const user = requireUser(c)
  const b = await jsonBody(c)
  const name = str(b.name, 'Name', { min: 1, max: 100 })
  await q('update "user" set name = $2, "updatedAt" = now() where id = $1', [user.id, name])
  await q(
    `insert into customer_profiles (user_id, order_updates, product_updates, download_reminders, review_requests) values ($1,$2,$3,$4,$5)
     on conflict (user_id) do update set order_updates = excluded.order_updates, product_updates = excluded.product_updates,
       download_reminders = excluded.download_reminders, review_requests = excluded.review_requests, updated_at = now()`,
    [
      user.id,
      b.order_updates === undefined ? true : bool(b.order_updates),
      b.product_updates === undefined ? true : bool(b.product_updates),
      b.download_reminders === undefined ? true : bool(b.download_reminders),
      b.review_requests === undefined ? true : bool(b.review_requests),
    ],
  )
  // The email list goes through the consent record (with its wording and history), never a silent flag.
  if (b.marketing !== undefined) await setAccountMarketing(user, bool(b.marketing), clientIp(c))
  return c.json({ ok: true })
})

function parseAddress(b: Record<string, unknown>) {
  return {
    name: str(b.name, 'Name', { min: 1, max: 100 }),
    line1: str(b.line1, 'Address line 1', { min: 1, max: 200 }),
    line2: str(b.line2, 'Address line 2', { optional: true, max: 200 }),
    city: str(b.city, 'City', { min: 1, max: 100 }),
    region: str(b.region, 'State or region', { optional: true, max: 100 }),
    postal_code: str(b.postal_code, 'ZIP or postal code', { min: 1, max: 20 }),
    country: str(b.country, 'Country', { min: 2, max: 2 }).toUpperCase(),
    phone: str(b.phone, 'Phone', { optional: true, max: 40 }),
    is_default: bool(b.is_default),
  }
}

// Saved addresses are separate from order records: changing one never rewrites past orders.
accountRoutes.post('/account/addresses', async (c) => {
  const user = requireUser(c)
  const a = parseAddress(await jsonBody(c))
  const count = await one<{ n: number }>('select count(*)::int as n from addresses where user_id = $1', [user.id])
  if ((count?.n ?? 0) >= 10) throw badRequest('You can save up to 10 addresses.')
  if (a.is_default) await q('update addresses set is_default = false where user_id = $1', [user.id])
  const row = await one(
    `insert into addresses (user_id, name, line1, line2, city, region, postal_code, country, phone, is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [user.id, a.name, a.line1, a.line2, a.city, a.region, a.postal_code, a.country, a.phone, a.is_default || (count?.n ?? 0) === 0],
  )
  return c.json(row, 201)
})

accountRoutes.put('/account/addresses/:id', async (c) => {
  const user = requireUser(c)
  const id = uuid(c.req.param('id'))
  const a = parseAddress(await jsonBody(c))
  if (a.is_default) await q('update addresses set is_default = false where user_id = $1', [user.id])
  const r = await q(`update addresses set name=$3, line1=$4, line2=$5, city=$6, region=$7, postal_code=$8, country=$9, phone=$10, is_default=$11 where id=$1 and user_id=$2 returning id`, [id, user.id, a.name, a.line1, a.line2, a.city, a.region, a.postal_code, a.country, a.phone, a.is_default])
  if (!r.length) throw notFound('Address')
  return c.json({ ok: true })
})

accountRoutes.delete('/account/addresses/:id', async (c) => {
  const user = requireUser(c)
  const r = await q('delete from addresses where id = $1 and user_id = $2 returning id', [uuid(c.req.param('id')), user.id])
  if (!r.length) throw notFound('Address')
  return c.json({ ok: true })
})

accountRoutes.get('/account/orders', async (c) => {
  const user = requireUser(c)
  const orders = await q(
    `select o.id, o.order_number, o.status, o.fulfillment_status, o.total_cents, o.refunded_cents, o.created_at, o.paid_at, o.is_demo, o.is_free_claim,
            (select json_agg(json_build_object('title', oi.title_snapshot, 'variant', oi.variant_snapshot, 'quantity', oi.quantity, 'type', oi.product_type) order by oi.title_snapshot) from order_items oi where oi.order_id = o.id) as items
       from orders o where o.user_id = $1 and o.status <> 'pending' order by o.created_at desc`,
    [user.id],
  )
  return c.json({ orders })
})

async function ownOrder(userId: string, orderNumber: string) {
  const o = await one<Record<string, unknown> & { id: string }>(`select * from orders where user_id = $1 and order_number = $2 and status <> 'pending'`, [userId, orderNumber])
  if (!o) throw notFound('Order')
  const [items, shipments, updates] = await Promise.all([
    q(`select id, product_id, product_type, title_snapshot as title, variant_snapshot as variant, sku_snapshot as sku, unit_price_cents, quantity, line_total_cents, refunded_quantity from order_items where order_id = $1 order by product_type, title_snapshot`, [o.id]),
    q(`select carrier, tracking_number, tracking_url, status, shipped_at, delivered_at from shipments where order_id = $1 order by created_at`, [o.id]),
    q(`select message, created_at from order_updates where order_id = $1 and customer_visible order by created_at`, [o.id]),
  ])
  const { stripe_checkout_session_id: _s, fee_cents: _f, ...safe } = o
  return { order: safe, items, shipments, updates }
}

accountRoutes.get('/account/orders/:number', async (c) => {
  const user = requireUser(c)
  return c.json(await ownOrder(user.id, c.req.param('number')))
})

/** Receipt from the order snapshot, so it never changes when listings change. */
accountRoutes.get('/account/orders/:number/receipt', async (c) => {
  const user = requireUser(c)
  const { order, items } = await ownOrder(user.id, c.req.param('number'))
  const o = order as Record<string, unknown>
  const cur = String(o.currency ?? 'usd')
  const billing = (o.billing_details ?? {}) as { name?: string; email?: string; address?: Record<string, string> | null }
  const ship = o.shipping_address as { name?: string; address?: Record<string, string> } | null
  const addr = (a?: Record<string, string> | null) => (a ? [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean).map((l) => escapeHtml(String(l))).join('<br>') : '')
  const row = (label: string, cents: unknown) => `<tr><td>${label}</td><td class="r">${money(Number(cents ?? 0), cur)}</td></tr>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(String(o.order_number))}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#680C35;max-width:720px;margin:32px auto;padding:0 16px}h1{font-family:Georgia,serif;font-weight:normal}table{width:100%;border-collapse:collapse}td,th{padding:8px 0;border-bottom:1px solid #EFD8DF;text-align:left}.r{text-align:right}.muted{color:#8A5A6C;font-size:13px}.grid{display:flex;gap:32px;flex-wrap:wrap;margin:16px 0}</style></head><body>
<h1>Nurse Love Company</h1><p class="muted">Made by a nurse, for nurses.</p>
<h2>Receipt for order ${escapeHtml(String(o.order_number))}</h2>
<p>Purchased ${escapeHtml(new Date(String(o.paid_at ?? o.created_at)).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))}<br>Payment status: ${escapeHtml(String(o.status).replace('_', ' '))}</p>
<div class="grid"><div><strong>Billed to</strong><br>${escapeHtml(billing.name ?? String(o.customer_name ?? ''))}<br>${escapeHtml(billing.email ?? String(o.email))}<br>${addr(billing.address)}</div>
${ship ? `<div><strong>Shipped to</strong><br>${escapeHtml(ship.name ?? '')}<br>${addr(ship.address)}</div>` : ''}</div>
<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>
${(items as Array<Record<string, unknown>>).map((i) => `<tr><td>${escapeHtml(String(i.title))}${i.variant ? ` (${escapeHtml(String(i.variant))})` : ''}${i.product_type === 'digital' ? '<br><span class="muted">Digital download. Binder not included.</span>' : ''}</td><td class="r">${i.quantity}</td><td class="r">${money(Number(i.unit_price_cents), cur)}</td><td class="r">${money(Number(i.unit_price_cents) * Number(i.quantity), cur)}</td></tr>`).join('')}
</tbody></table>
<table style="margin-top:16px">${row('Subtotal', o.subtotal_cents)}${Number(o.discount_cents) ? row('Discounts', -Number(o.discount_cents)) : ''}${row('Shipping', o.shipping_cents)}${row('Tax', o.tax_cents)}<tr><td><strong>Total</strong></td><td class="r"><strong>${money(Number(o.total_cents), cur)}</strong></td></tr>${Number(o.refunded_cents) ? row('Refunded', -Number(o.refunded_cents)) : ''}</table>
${o.is_demo ? '<p class="muted"><strong>Demo order.</strong> Sample data for the preview. No payment was taken.</p>' : ''}
<p class="muted">Payment reference: ${escapeHtml(String(o.stripe_payment_intent_id ?? 'not available'))}</p></body></html>`
  const download = c.req.query('download') === '1'
  return c.body(html, 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    ...(download ? { 'content-disposition': `attachment; filename="receipt-${String(o.order_number)}.html"` } : {}),
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
})

accountRoutes.get('/account/downloads', async (c) => {
  const user = requireUser(c)
  return c.json({ downloads: await listDownloads(user.id) })
})

accountRoutes.post('/downloads/:id/prepare', async (c) => {
  const user = requireUser(c)
  return c.json(await prepareDownload(user, uuid(c.req.param('id')), { ip: clientIp(c), ua: c.req.header('user-agent') }))
})

accountRoutes.get('/downloads/deliver/:token', async (c) => {
  const user = requireUser(c)
  const d = await startDelivery(user, c.req.param('token'), { ip: clientIp(c), ua: c.req.header('user-agent') })
  return new Response(toWebBody(d.stream, d.onFinished), {
    headers: {
      'content-type': d.contentType,
      'content-length': String(d.size),
      'content-disposition': `attachment; filename="${d.fileName.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  })
})

accountRoutes.post('/downloads/:id/report', async (c) => {
  const user = requireUser(c)
  const b = await jsonBody(c)
  const message = str(b.message, 'Please describe the problem', { min: 5, max: 2000 })
  return c.json(await reportProblem(user, uuid(c.req.param('id')), message), 201)
})

accountRoutes.post('/account/support', async (c) => {
  const user = requireUser(c)
  await rateLimit(`support:${user.id}`, 5, 3600)
  const b = await jsonBody(c)
  let orderId: string | null = null
  if (b.order_number) {
    const o = await one<{ id: string }>('select id from orders where order_number = $1 and user_id = $2', [String(b.order_number), user.id])
    if (!o) throw notFound('Order')
    orderId = o.id
  }
  const row = await one(`insert into support_requests (user_id, order_id, subject, message) values ($1,$2,$3,$4) returning id`, [user.id, orderId, str(b.subject, 'Subject', { min: 2, max: 140 }), str(b.message, 'Message', { min: 5, max: 4000 })])
  return c.json(row, 201)
})

/*
  First admin. Works only while the store has no admin at all, and only with
  the ADMIN_BOOTSTRAP_TOKEN set on the server. The signed in account becomes
  the first admin; after that this endpoint refuses every request.
*/
accountRoutes.post('/admin-bootstrap', async (c) => {
  const user = requireUser(c)
  await rateLimit(`bootstrap:${clientIp(c)}`, 5, 900)
  const expected = config.adminBootstrapToken
  if (!expected) throw new HttpError(404, 'Admin setup is not enabled.', 'not_enabled')
  const given = Buffer.from(String((await jsonBody(c)).token ?? ''))
  const want = Buffer.from(expected)
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(403, 'That setup code is not correct.', 'bad_token')
  const done = await tx(async (client) => {
    await client.query('select pg_advisory_xact_lock(727003)')
    const admins = await one<{ n: number }>(`select count(*)::int as n from "user" where role = 'admin'`, [], client)
    if ((admins?.n ?? 0) > 0) return false
    await q(`update "user" set role = 'admin' where id = $1`, [user.id], client)
    await q(`insert into audit_log (actor_id, actor_email, action, entity_type, entity_id, summary, ip) values ($1,$2,'admin.bootstrapped','user',$1,$3,$4)`, [user.id, user.email, `${user.email} became the first admin using the setup code`, clientIp(c)], client)
    return true
  })
  if (!done) throw new HttpError(409, 'This store already has an admin. Ask them to give you access in Settings.', 'already_set_up')
  return c.json({ ok: true })
})

/* Cart and checkout */

accountRoutes.post('/cart/price', async (c) => {
  const b = await jsonBody<{ items: CartLine[] }>(c)
  const lines = await priceCart(c.get('user'), b.items ?? [])
  return c.json({ lines, subtotal_cents: lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0) })
})

accountRoutes.post('/checkout', async (c) => {
  const user = requireUser(c)
  await rateLimit(`checkout:${user.id}`, 10, 60)
  const b = await jsonBody<{ items: CartLine[]; join_list?: boolean }>(c)
  return c.json(await createCheckout(user, b.items ?? [], { joinList: b.join_list === true, ip: clientIp(c) }))
})

/** The customer's email list status, so checkout shows their real preference. */
accountRoutes.get('/account/marketing', async (c) => {
  const user = requireUser(c)
  return c.json(await marketingStatus(user))
})
