import './env.js'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import Stripe from 'stripe'
import { Webhook } from 'svix'
import { createApp } from '../app.js'
import { boot } from '../boot.js'
import { one, q } from '../db/pool.js'
import { drainOutbox, setSender } from '../email/outbox.js'
import { resetRateLimits } from '../lib/rate-limit.js'
import { storage } from '../lib/storage.js'
import { buildSamplePlannerPdf } from '../../shared/samplePdf.js'

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://nurselove:nurselove-local@localhost:5432/nurselove_test'
export const ORIGIN = 'http://localhost:5173'

/** On staging tests, every request passes the access gate unless told otherwise. */
export const GATE = process.env.DEPLOY_ENV === 'staging' ? `Basic ${Buffer.from(`${process.env.STAGING_ACCESS_USER ?? 'nurselove'}:${process.env.STAGING_ACCESS_PASSWORD}`).toString('base64')}` : null

let booted: Awaited<ReturnType<typeof boot>> | null = null
export let app: ReturnType<typeof createApp>

/** Boots once per process and wipes all data so each test file starts clean. */
export async function setup() {
  if (!booted) {
    booted = await boot(TEST_DB)
    app = createApp()
  }
  const tables = await q<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`)
  await q(`set session_replication_role = replica`)
  await q(`truncate ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`)
  await q(`set session_replication_role = origin`)
  await rm('.data/test-storage', { recursive: true, force: true })
  resetRateLimits()
  setSender(null)
}

export async function teardown() {
  await booted?.end()
  booted = null
}

export interface Session {
  cookie: string
  id: string
  email: string
}

export async function signUp(email: string, role: 'customer' | 'admin' = 'customer', name = 'Test Person'): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(GATE ? { authorization: GATE } : {}) },
    body: JSON.stringify({ email, password: 'Correct-Horse-1', name }),
  })
  if (res.status !== 200) throw new Error(`sign up failed ${res.status} ${await res.text()}`)
  const user = await one<{ id: string }>('select id from "user" where email = $1', [email])
  if (role === 'admin') await q(`update "user" set role = 'admin' where id = $1`, [user!.id])
  const signIn = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(GATE ? { authorization: GATE } : {}) },
    body: JSON.stringify({ email, password: 'Correct-Horse-1' }),
  })
  const cookie = (signIn.headers.getSetCookie?.() ?? [signIn.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .join('; ')
  return { cookie, id: user!.id, email }
}

export async function api(path: string, opts: { session?: Session | null; method?: string; body?: unknown; headers?: Record<string, string>; noGate?: boolean } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, ...(GATE && !opts.noGate ? { authorization: GATE } : {}), ...(opts.headers ?? {}) }
  if (opts.session) headers.cookie = opts.session.cookie
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (opts.body instanceof Uint8Array || Buffer.isBuffer(opts.body)) body = opts.body as BodyInit
    else {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
  }
  const res = await app.request(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body })
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : type.startsWith('text/') ? await res.text() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data: data as any, headers: res.headers }
}

/** Creates a published digital product with a released version 1 file. */
export async function digitalProduct(slug = 'np-test-pages', price = 1200) {
  const p = await one<{ id: string }>(
    `insert into products (slug, title, category, type, price_cents, status, active, show_binder_notice) values ($1,$2,'np-inserts','digital',$3,'published',true,true) returning id`,
    [slug, `Test ${slug}`, price],
  )
  const v = await addVersion(p!.id, 1)
  await q('update products set current_version_id = $2 where id = $1', [p!.id, v])
  return p!.id
}

export async function addVersion(productId: string, n: number) {
  const pdf = buildSamplePlannerPdf(`Version ${n}`)
  const stored = await storage().put(`product-files/${productId}/v${n}.pdf`, Readable.from([Buffer.from(pdf)], { objectMode: false }), 'application/pdf', 10_000_000)
  const v = await one<{ id: string }>(
    `insert into product_versions (product_id, version_number, storage_key, file_name, content_type, file_size, sha256) values ($1,$2,$3,$4,'application/pdf',$5,$6) returning id`,
    [productId, n, stored.key, `file-v${n}.pdf`, stored.size, stored.sha256],
  )
  return v!.id
}

export async function stagedUpload(productId: string, n: number) {
  const pdf = buildSamplePlannerPdf(`Staged ${n}`)
  const stored = await storage().put(`product-files/${productId}/staged-${n}.pdf`, Readable.from([Buffer.from(pdf)], { objectMode: false }), 'application/pdf', 10_000_000)
  const u = await one<{ id: string }>(
    `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256) values ($1,$2,$3,'application/pdf',$4,$5) returning id`,
    [productId, stored.key, `staged-${n}.pdf`, stored.size, stored.sha256],
  )
  return u!.id
}

export async function physicalProduct(slug = 'test-tee', stock = 5) {
  const p = await one<{ id: string }>(
    `insert into products (slug, title, category, type, price_cents, status, active, inventory_quantity) values ($1,$2,'apparel','physical',2500,'published',true,$3) returning id`,
    [slug, `Test ${slug}`, stock],
  )
  return p!.id
}

/** Creates a pending order the way checkout does (without calling Stripe). */
export async function pendingOrder(user: Session, items: Array<{ productId: string; quantity?: number }>) {
  const o = await one<{ id: string; order_number: string }>(`insert into orders (user_id, email, customer_name, status, subtotal_cents, total_cents) values ($1,$2,'Test Person','pending',0,0) returning id, order_number`, [user.id, user.email])
  let subtotal = 0
  for (const it of items) {
    const p = await one<{ type: string; title: string; price_cents: number; category: string }>('select type, title, price_cents, category from products where id = $1', [it.productId])
    const qty = it.quantity ?? 1
    subtotal += p!.price_cents * qty
    await q(
      `insert into order_items (order_id, product_id, product_type, title_snapshot, category_snapshot, unit_price_cents, quantity, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o!.id, it.productId, p!.type, p!.title, p!.category, p!.price_cents, qty, p!.price_cents * qty],
    )
  }
  await q('update orders set subtotal_cents = $2, total_cents = $2 where id = $1', [o!.id, subtotal])
  return { ...o!, subtotal }
}

/* Signed webhook deliveries, exactly as Stripe and Resend send them. */

let eventSeq = 0
export function stripeEvent(type: string, object: Record<string, unknown>, id = `evt_test_${Date.now()}_${eventSeq++}`) {
  return { id, object: 'event', type, api_version: '2026-10-28', created: Math.floor(Date.now() / 1000), data: { object }, livemode: false, pending_webhooks: 1, request: null }
}

export async function postStripe(event: unknown, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const payload = JSON.stringify(event)
  const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret })
  const res = await app.request('/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload })
  return { status: res.status, data: (await res.json()) as any }
}

export function checkoutCompleted(orderId: string, amount: number, extra: Record<string, unknown> = {}) {
  return stripeEvent('checkout.session.completed', {
    id: `cs_test_${orderId.slice(0, 8)}`,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_subtotal: amount,
    amount_total: amount,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    customer_details: { name: 'Test Person', email: 'buyer@example.com', address: { line1: '1 Test Way', city: 'Testville', state: 'NC', postal_code: '27601', country: 'US' } },
    payment_intent: `pi_test_${orderId.slice(0, 8)}`,
    metadata: { order_id: orderId },
    client_reference_id: orderId,
    ...extra,
  })
}

export async function payOrder(orderId: string, amount: number, extra: Record<string, unknown> = {}) {
  const r = await postStripe(checkoutCompleted(orderId, amount, extra))
  if (r.status !== 200) throw new Error(`payment webhook failed: ${JSON.stringify(r.data)}`)
  return r
}

export async function postResend(event: unknown, svixId = `msg_${Date.now()}_${eventSeq++}`) {
  const payload = JSON.stringify(event)
  const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET!)
  const ts = new Date()
  const signature = wh.sign(svixId, ts, payload)
  const res = await app.request('/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': svixId, 'svix-timestamp': String(Math.floor(ts.getTime() / 1000)), 'svix-signature': signature },
    body: payload,
  })
  return { status: res.status, data: (await res.json()) as any }
}

export async function entitlementsFor(userId: string) {
  return q<{ id: string; status: string; source: string; version_id: string; order_item_id: string }>('select id, status, source, version_id, order_item_id from entitlements where user_id = $1 order by granted_at', [userId])
}

export { drainOutbox, setSender, one, q }
