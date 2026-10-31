import './env.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { config } from '../env.js'
import { setPrintfulTransport, type PrintfulTransport } from '../lib/printful.js'
import { setStripeForTests } from '../lib/stripe.js'
import { printfulIdle, runPrintfulQueue, setLivePaymentsForTests } from '../services/printful.js'
import { api, app, digitalProduct, drainOutbox, entitlementsFor, one, payOrder, physicalProduct, q, setup, signUp, teardown, type Session } from './helpers.js'

/*
  Printful is replaced by an in memory fake that follows the documented API
  shapes (v1: {code, result}), with switches for the failures that matter:
  a create that times out after Printful accepted it, a declined charge on
  confirmation, a refused order, an unreachable service. No test reaches the
  real Printful, and nothing here can create a chargeable order.
*/

type Order = { id: number; external_id: string; status: string; shipping: string; recipient: Record<string, unknown>; items: Array<{ id: number; external_id: string; sync_variant_id: number; quantity: number }>; shipments: unknown[]; costs: Record<string, unknown> }

class FakePrintful {
  calls: string[] = []
  orders: Order[] = []
  nextId = 5000
  products = new Map<number, { sync_product: Record<string, unknown>; sync_variants: Array<Record<string, unknown>> }>()
  timeoutAfterCreate = false
  confirmError: string | null = null
  refuseCreate: string | null = null
  ratesError: { status: number; message: string } | null = null
  down = false
  webhook: { url?: string; types?: string[] } | null = null

  addProduct(id: number, variants: Array<{ id: number; variant_id: number; size?: string; color?: string; availability_status?: string; files?: unknown[]; is_ignored?: boolean; synced?: boolean }>) {
    this.products.set(id, {
      sync_product: { id, name: `Printful product ${id}`, variants: variants.length, synced: variants.length },
      sync_variants: variants.map((v) => ({
        sync_product_id: id,
        name: `Tee / ${v.color ?? ''} / ${v.size ?? ''}`,
        synced: v.synced ?? true,
        is_ignored: v.is_ignored ?? false,
        availability_status: v.availability_status ?? 'active',
        files: v.files ?? [{ type: 'default', status: 'ok', preview_url: 'https://files.example/p.png' }],
        retail_price: '25.00',
        currency: 'USD',
        ...v,
      })),
    })
  }
  variant(id: number) {
    for (const p of this.products.values()) {
      const v = p.sync_variants.find((x) => x.id === id)
      if (v) return { sync_variant: v, sync_product: p.sync_product }
    }
    return null
  }
  order(id: number) {
    return this.orders.find((o) => o.id === id)
  }
  ship(orderId: number, s: { id: number; items: Array<{ external_id: string; quantity: number }>; tracking: string; delivered_at?: number }) {
    const o = this.order(orderId)!
    o.shipments.push({
      id: s.id,
      carrier: 'USPS',
      service: 'First Class',
      tracking_number: s.tracking,
      tracking_url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${s.tracking}`,
      shipped_at: Math.floor(Date.now() / 1000) - 60,
      reshipment: false,
      items: s.items.map((i) => ({ item_id: o.items.find((x) => x.external_id === i.external_id)!.id, quantity: i.quantity })),
      ...(s.delivered_at ? { delivered_at: s.delivered_at } : {}),
    })
    o.status = o.shipments.length && o.items.every((it) => (o.shipments as Array<{ items: Array<{ item_id: number; quantity: number }> }>).some((sh) => sh.items.some((x) => x.item_id === it.id))) ? 'fulfilled' : 'partial'
  }

  transport: PrintfulTransport = async (req) => {
    const url = new URL(req.url)
    const path = url.pathname
    this.calls.push(`${req.method} ${path}${url.search}`)
    if (this.down) throw new Error('connect ETIMEDOUT')
    assert.equal(req.headers.authorization, 'Bearer test-printful-token')
    const ok = (result: unknown) => ({ status: 200, body: { code: 200, result } })
    const err = (status: number, result: string) => ({ status, body: { code: status, result, error: { reason: 'Error', message: result } } })
    const body = req.body ? JSON.parse(req.body) : null
    let m: RegExpMatchArray | null
    if (req.method === 'GET' && path === '/stores') return ok([{ id: 77, name: 'Nurse Love Company', type: 'native' }])
    if (req.method === 'GET' && path === '/store/products') return ok([...this.products.values()].map((p) => p.sync_product))
    if (req.method === 'GET' && (m = path.match(/^\/store\/products\/(\d+)$/))) {
      const p = this.products.get(Number(m[1]))
      return p ? ok(p) : err(404, 'Not found')
    }
    if (req.method === 'GET' && (m = path.match(/^\/store\/variants\/(\d+)$/))) {
      const v = this.variant(Number(m[1]))
      return v ? ok(v) : err(404, 'Not found')
    }
    if (req.method === 'POST' && path === '/shipping/rates') {
      if (this.ratesError) return err(this.ratesError.status, this.ratesError.message)
      assert.ok(body.items.every((i: { variant_id: number }) => Number.isInteger(i.variant_id)), 'rates use Printful catalog variant ids')
      return ok([
        { id: 'STANDARD', name: 'Flat Rate (3-4 business days after fulfillment)', rate: '4.75', currency: 'USD', minDeliveryDays: 3, maxDeliveryDays: 4 },
        { id: 'EXPRESS', name: 'Express', rate: '12.40', currency: 'USD', minDeliveryDays: 1, maxDeliveryDays: 2 },
      ])
    }
    if (req.method === 'POST' && path === '/orders/estimate-costs') return ok({ costs: { total: '18.20', currency: 'USD' } })
    if (req.method === 'POST' && path === '/orders') {
      if (this.refuseCreate) return err(400, this.refuseCreate)
      if (this.orders.some((o) => o.external_id === body.external_id)) return err(400, 'Order with this External ID already exists (OR-13).')
      const confirm = url.searchParams.get('confirm') === 'true'
      const o: Order = {
        id: this.nextId++,
        external_id: body.external_id,
        status: confirm ? (this.confirmError ? 'failed' : 'pending') : 'draft',
        shipping: body.shipping,
        recipient: body.recipient,
        items: body.items.map((i: { sync_variant_id: number; quantity: number; external_id: string }, n: number) => ({ id: 900 + this.orders.length * 10 + n, external_id: i.external_id, sync_variant_id: i.sync_variant_id, quantity: i.quantity })),
        shipments: [],
        costs: { subtotal: '13.95', shipping: '4.75', total: '18.70', currency: 'USD' },
      }
      this.orders.push(o)
      if (this.timeoutAfterCreate) {
        this.timeoutAfterCreate = false
        throw new Error('socket hang up') // Printful kept the order, but we never heard back.
      }
      return ok(o)
    }
    if (req.method === 'GET' && (m = path.match(/^\/orders\/@(.+)$/))) {
      const o = this.orders.find((x) => x.external_id === m![1])
      return o ? ok(o) : err(404, 'Not found')
    }
    if ((m = path.match(/^\/orders\/(\d+)(\/confirm)?$/))) {
      const o = this.order(Number(m[1]))
      if (!o) return err(404, 'Not found')
      if (req.method === 'GET' && !m[2]) return ok(o)
      if (req.method === 'POST' && m[2]) {
        if (this.confirmError) {
          o.status = 'failed'
          return err(400, this.confirmError)
        }
        o.status = 'pending'
        return ok(o)
      }
      if (req.method === 'DELETE') {
        if (!['draft', 'pending', 'failed'].includes(o.status)) return err(400, 'Order is being fulfilled and can no longer be cancelled.')
        o.status = 'canceled'
        return ok(o)
      }
    }
    if (path === '/webhooks') {
      if (req.method === 'POST') this.webhook = body
      return ok(this.webhook ?? {})
    }
    return err(404, `Fake Printful has no ${req.method} ${path}`)
  }
}

let fake: FakePrintful
const sessions: Array<Record<string, any>> = []
const fakeStripe = {
  customers: { create: async (p: Record<string, unknown>) => ({ id: `cus_${sessions.length}`, ...p }) },
  checkout: { sessions: { create: async (p: Record<string, unknown>) => (sessions.push(p), { id: `cs_fake_${sessions.length}_${Math.random().toString(36).slice(2, 8)}`, url: 'https://checkout.stripe.test/s' }) } },
}

const ADDRESS = { name: 'Riley Nurse', address1: '1 Main St', city: 'Raleigh', state_code: 'NC', country_code: 'US', zip: '27601', phone: '' }

async function linkedTee(admin: Session, opts: { availability?: string } = {}) {
  const teeId = await physicalProduct('pf-tee', 0)
  const small = await one<{ id: string }>(`insert into product_variants (product_id, title, options) values ($1,'Pink / S','{"size":"S","color":"Pink"}') returning id`, [teeId])
  const medium = await one<{ id: string }>(`insert into product_variants (product_id, title, options) values ($1,'Pink / M','{"size":"M","color":"Pink"}') returning id`, [teeId])
  fake.addProduct(301, [
    { id: 4001, variant_id: 11001, size: 'S', color: 'Pink' },
    { id: 4002, variant_id: 11002, size: 'M', color: 'Pink', availability_status: opts.availability ?? 'active' },
  ])
  const r = await api(`/api/admin/products/${teeId}/printful`, { session: admin, method: 'PUT', body: { sync_product_id: 301, links: [{ variant_id: small!.id, sync_variant_id: 4001 }, { variant_id: medium!.id, sync_variant_id: 4002 }] } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return { teeId, small: small!.id, medium: medium!.id }
}

async function openSales(admin: Session, autoConfirm = true) {
  const r = await api('/api/admin/settings/printful', { session: admin, method: 'PUT', body: { physical_sales: true, auto_confirm: autoConfirm } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
}

/** Quote, check out (fake Stripe), and pay (signed Stripe webhook). */
async function buy(buyer: Session, items: Array<{ productId: string; variantId?: string; quantity?: number }>, optionId = 'STANDARD') {
  const lines = items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity ?? 1 }))
  const quote = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })
  assert.equal(quote.status, 200, JSON.stringify(quote.data))
  const option = quote.data.options.find((o: { id: string }) => o.id === optionId)
  const co = await api('/api/checkout', { session: buyer, body: { items: lines, shipping: { quote_id: quote.data.quoteId, option_id: optionId } } })
  assert.equal(co.status, 200, JSON.stringify(co.data))
  const order = (await one<{ id: string; subtotal_cents: number }>('select id, subtotal_cents from orders where order_number = $1', [co.data.orderNumber]))!
  const total = order.subtotal_cents + option.rate_cents
  await payOrder(order.id, total, { amount_subtotal: order.subtotal_cents, amount_total: total, total_details: { amount_discount: 0, amount_shipping: option.rate_cents, amount_tax: 0 } })
  await printfulIdle()
  return { orderId: order.id, option, session: sessions[sessions.length - 1] }
}

const job = (orderId: string) => one<{ state: string; printful_order_id: string | null; printful_status: string; attention_reason: string; attempts: number }>('select * from printful_orders where order_id = $1', [orderId])
const creates = () => fake.calls.filter((c) => c.startsWith('POST /orders?')).length

async function postWebhook(body: unknown, opts: { token?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body)
  const res = await app.request(`/api/webhooks/printful${opts.token === undefined ? `/${config.printful.webhookToken}` : opts.token ? `/${opts.token}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.signature ? { 'x-pf-webhook-signature': opts.signature } : {}) },
    body: raw,
  })
  return { status: res.status, data: (await res.json()) as any }
}

describe('Printful fulfillment', () => {
  const saved = { ...config.printful }
  before(() => {
    Object.assign(config.printful, { apiToken: 'test-printful-token', storeId: '', webhookToken: 'pf-webhook-token-0123456789abcdef', webhookSecret: '' })
  })
  beforeEach(async () => {
    await setup()
    fake = new FakePrintful()
    setPrintfulTransport(fake.transport)
    setStripeForTests(fakeStripe)
    setLivePaymentsForTests(true)
    sessions.length = 0
  })
  afterEach(async () => {
    await printfulIdle()
  })
  after(async () => {
    Object.assign(config.printful, saved)
    setPrintfulTransport(null)
    setStripeForTests(null)
    setLivePaymentsForTests(null)
    await teardown()
  })

  it('links exact Printful variants only, shows availability, and blocks unmapped or unavailable items', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small, medium } = await linkedTee(admin, { availability: 'discontinued' })
    fake.addProduct(302, [{ id: 4100, variant_id: 12000 }])
    // A variant from another Printful product is refused; so is one Printful variant for two options.
    assert.equal((await api(`/api/admin/products/${teeId}/printful`, { session: admin, method: 'PUT', body: { sync_product_id: 301, links: [{ variant_id: small, sync_variant_id: 4100 }] } })).status, 400)
    assert.equal((await api(`/api/admin/products/${teeId}/printful`, { session: admin, method: 'PUT', body: { sync_product_id: 301, links: [{ variant_id: small, sync_variant_id: 4001 }, { variant_id: medium, sync_variant_id: 4001 }] } })).status, 400)
    const links = (await api(`/api/admin/products/${teeId}/printful`, { session: admin })).data
    assert.deepEqual(links.items.map((i: any) => [i.title, Number(i.link?.sync_variant_id), i.link?.available]), [['Pink / S', 4001, true], ['Pink / M', 4002, false]])
    assert.match(links.items[1].link.problem, /discontinued/)

    const product = (await api('/api/products/pf-tee')).data.product
    assert.deepEqual(product.variants.map((v: any) => [v.title, v.inStock]), [['Pink / S', true], ['Pink / M', false]])
    await openSales(admin)
    const blocked = await api('/api/cart/price', { session: buyer, body: { items: [{ productId: teeId, variantId: medium, quantity: 1 }] } })
    assert.equal(blocked.status, 409)
    assert.match(blocked.data.error, /Pink \/ M\) is not available to order right now/)
    // A new option with no Printful link cannot be bought.
    const large = await one<{ id: string }>(`insert into product_variants (product_id, title, options) values ($1,'Pink / L','{}') returning id`, [teeId])
    assert.equal((await api('/api/cart/price', { session: buyer, body: { items: [{ productId: teeId, variantId: large!.id, quantity: 1 }] } })).status, 409)
    // Local stock is never needed for Printful items (the product was created with stock 0).
    assert.equal((await api('/api/cart/price', { session: buyer, body: { items: [{ productId: teeId, variantId: small, quantity: 3 }] } })).status, 200)
  })

  it('imports options from a Printful product, one link each', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const teeId = await physicalProduct('pf-import', 0)
    fake.addProduct(303, [{ id: 4201, variant_id: 13001, size: 'S', color: 'Black' }, { id: 4202, variant_id: 13002, size: 'M', color: 'Black' }, { id: 4203, variant_id: 13003, is_ignored: true }])
    const r = await api(`/api/admin/products/${teeId}/printful/import`, { session: admin, body: { sync_product_id: 303 } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.deepEqual(r.data.items.map((i: any) => [i.title, Number(i.link.sync_variant_id)]), [['Black / S', 4201], ['Black / M', 4202]])
    assert.equal((await api(`/api/admin/products/${teeId}/printful/import`, { session: admin, body: { sync_product_id: 303 } })).status, 400, 'never imports over existing options')
  })

  it('quotes real shipping for the address before payment, and checkout charges exactly the chosen option', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    const lines = [{ productId: teeId, variantId: small, quantity: 2 }]
    const closed = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })
    assert.equal(closed.status, 409, 'physical checkout stays closed until the owner opens it')
    assert.equal((await api('/api/status')).data.physicalSales.open, false)
    await openSales(admin)
    assert.equal((await api('/api/status')).data.physicalSales.open, true)

    assert.equal((await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: { ...ADDRESS, country_code: 'FR' } } })).status, 400, 'only countries the store ships to')
    assert.equal((await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: { ...ADDRESS, state_code: '' } } })).status, 400)
    fake.ratesError = { status: 400, message: 'Recipient address is not valid.' }
    const bad = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })
    assert.equal(bad.status, 422)
    assert.match(bad.data.error, /Recipient address is not valid/)
    fake.ratesError = null
    fake.down = true
    assert.equal((await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })).status, 503)
    fake.down = false

    const quote = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })
    assert.equal(quote.status, 200, JSON.stringify(quote.data))
    assert.deepEqual(quote.data.options.map((o: any) => [o.id, o.rate_cents]), [['STANDARD', 475], ['EXPRESS', 1240]])
    // No quote, a changed bag or an expired quote cannot check out.
    assert.equal((await api('/api/checkout', { session: buyer, body: { items: lines } })).status, 400)
    assert.equal((await api('/api/checkout', { session: buyer, body: { items: [{ ...lines[0], quantity: 1 }], shipping: { quote_id: quote.data.quoteId, option_id: 'STANDARD' } } })).status, 409)
    const other = await signUp('other@example.com')
    assert.equal((await api('/api/checkout', { session: other, body: { items: lines, shipping: { quote_id: quote.data.quoteId, option_id: 'STANDARD' } } })).status, 400, 'a quote belongs to one customer')
    await q(`update shipping_quotes set expires_at = now() - interval '1 minute' where id = $1`, [quote.data.quoteId])
    assert.equal((await api('/api/checkout', { session: buyer, body: { items: lines, shipping: { quote_id: quote.data.quoteId, option_id: 'STANDARD' } } })).status, 409)

    const fresh = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: lines, address: ADDRESS } })
    const co = await api('/api/checkout', { session: buyer, body: { items: lines, shipping: { quote_id: fresh.data.quoteId, option_id: 'EXPRESS' } } })
    assert.equal(co.status, 200, JSON.stringify(co.data))
    const s = sessions[sessions.length - 1]
    assert.equal(s.shipping_options.length, 1)
    assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 1240)
    assert.equal(s.shipping_options[0].shipping_rate_data.display_name, 'Express')
    assert.equal(s.shipping_address_collection, undefined, 'the address was already given and quoted')
    assert.ok(s.customer, 'the quoted address travels with a Stripe customer')
    const o = (await one<{ shipping_address: any; shipping_method: any }>('select shipping_address, shipping_method from orders where order_number = $1', [co.data.orderNumber]))!
    assert.equal(o.shipping_address.address.postal_code, '27601')
    assert.deepEqual(o.shipping_method.items.map((i: any) => [i.sync_variant_id, i.quantity]), [[4001, 2]])
  })

  it('digital only carts need no address and no shipping; mixed carts ship only the physical items', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const digitalId = await digitalProduct('pf-digital')
    const co = await api('/api/checkout', { session: buyer, body: { items: [{ productId: digitalId, quantity: 1 }] } })
    assert.equal(co.status, 200, JSON.stringify(co.data))
    assert.equal(sessions[0].shipping_options, undefined)
    assert.ok(!fake.calls.some((c) => c.includes('/shipping/rates')))

    const { teeId, small } = await linkedTee(admin)
    await openSales(admin)
    const digital2 = await digitalProduct('pf-digital-2')
    const quote = await api('/api/checkout/shipping-quote', { session: buyer, body: { items: [{ productId: digital2, quantity: 1 }, { productId: teeId, variantId: small, quantity: 1 }], address: ADDRESS } })
    assert.equal(quote.status, 200)
    const { orderId } = await buy(buyer, [{ productId: digital2 }, { productId: teeId, variantId: small }])
    const pf = fake.orders[0]
    assert.deepEqual(pf.items.map((i) => [i.sync_variant_id, i.quantity]), [[4001, 1]], 'only the physical item goes to Printful')
    const dl = await one<{ status: string }>(`select e.status from entitlements e join order_items oi on oi.id = e.order_item_id where oi.order_id = $1`, [orderId])
    assert.equal(dl?.status, 'available', 'the download is ready at once')
  })

  it('a verified payment sends the right items, address and service to Printful and confirms it, exactly once', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small, medium } = await linkedTee(admin)
    await openSales(admin, true)
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small, quantity: 2 }, { productId: teeId, variantId: medium, quantity: 1 }], 'EXPRESS')
    assert.equal(fake.orders.length, 1)
    const pf = fake.orders[0]
    assert.equal(pf.external_id, orderId.replace(/-/g, ''))
    assert.equal(pf.shipping, 'EXPRESS')
    assert.deepEqual(pf.items.map((i) => [i.sync_variant_id, i.quantity]).sort(), [[4001, 2], [4002, 1]])
    assert.equal(pf.recipient.zip, '27601')
    assert.equal(pf.status, 'pending', 'confirmed for production, not left as a draft')
    const j = (await job(orderId))!
    assert.equal(j.state, 'submitted')
    assert.equal(Number(j.printful_order_id), pf.id)

    // Stripe sends the same payment event again, and two workers run at once: still one Printful order.
    const order = (await one<{ subtotal_cents: number; total_cents: number }>('select * from orders where id = $1', [orderId]))!
    await payOrder(orderId, order.total_cents, { amount_subtotal: order.subtotal_cents })
    await Promise.all([runPrintfulQueue(), runPrintfulQueue(), printfulIdle()])
    assert.equal(fake.orders.length, 1)
    assert.equal(creates(), 1)
    assert.equal((await one<{ n: number }>('select count(*)::int as n from printful_orders'))!.n, 1)
  })

  it('a create that times out after Printful accepted it is reconciled, never sent twice', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    fake.timeoutAfterCreate = true
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }])
    assert.equal(fake.orders.length, 1, 'Printful has the order')
    assert.equal((await job(orderId))!.state, 'uncertain', 'but we are not sure, so it is not called submitted')
    await q(`update printful_orders set next_attempt_at = now() where order_id = $1`, [orderId])
    await runPrintfulQueue()
    assert.equal(fake.orders.length, 1)
    assert.equal(creates(), 1, 'the retry looked the order up by external id instead of creating it again')
    assert.ok(fake.calls.includes(`GET /orders/@${orderId.replace(/-/g, '')}`))
    const j = (await job(orderId))!
    assert.equal(j.state, 'submitted')
    assert.equal(fake.orders[0].status, 'pending')
  })

  it('a declined Printful charge flags the order and emails the admins; it is never shown as submitted or shipped', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    fake.confirmError = 'Charge failed: the card was declined.'
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }])
    let j = (await job(orderId))!
    assert.equal(j.state, 'needs_attention')
    assert.match(j.attention_reason, /could not process|billing|declined/i)
    const alert = await one<{ to_email: string; subject: string }>(`select to_email, subject from emails where type = 'fulfillment_alert' and related_order_id = $1`, [orderId])
    assert.equal(alert!.to_email, 'owner@example.com')
    assert.ok(await one(`select 1 from order_notes where order_id = $1 and body like 'Printful:%'`, [orderId]))
    const detail = await api(`/api/admin/orders/${orderId}`, { session: admin })
    assert.equal(detail.data.order.fulfillment_status, 'unfulfilled')
    assert.equal(detail.data.shipments.length, 0)
    // The owner fixes billing in Printful, then confirms from the order.
    fake.confirmError = null
    const r = await api(`/api/admin/orders/${orderId}/printful/confirm`, { session: admin, body: {} })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    j = (await job(orderId))!
    assert.equal(j.state, 'submitted')
    assert.equal(fake.orders.length, 1)
  })

  it('a Stripe test payment only ever creates a non chargeable Printful draft, even with automatic confirmation on', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    setLivePaymentsForTests(false)
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }])
    assert.equal(fake.orders.length, 1)
    assert.equal(fake.orders[0].status, 'draft', 'never confirmed, so Printful charges nothing')
    assert.ok(!fake.calls.some((c) => c.includes('/confirm') || c.includes('confirm=true')))
    const j = (await job(orderId))!
    assert.equal(j.state, 'draft')
    assert.match(j.attention_reason, /test card/)
    await runPrintfulQueue()
    assert.equal(fake.orders[0].status, 'draft', 'the hourly run does not confirm it either')
  })

  it('with automatic confirmation off, the order waits as a Printful draft for the owner', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, false)
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }])
    assert.equal(fake.orders[0].status, 'draft')
    assert.equal((await job(orderId))!.state, 'draft')
    assert.ok(await one(`select 1 from emails where type = 'fulfillment_alert' and related_order_id = $1`, [orderId]), 'the owner is told it waits for them')
    await api(`/api/admin/orders/${orderId}/printful/confirm`, { session: admin, body: {} })
    assert.equal(fake.orders[0].status, 'pending')
    assert.equal((await job(orderId))!.state, 'submitted')
  })

  it('a refused order needs attention; an unreachable Printful retries later; downloads never wait for Printful', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const digitalId = await digitalProduct('pf-dl')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    fake.refuseCreate = 'Recipient: address is not deliverable.'
    const a = await buy(buyer, [{ productId: teeId, variantId: small }, { productId: digitalId }])
    assert.equal((await job(a.orderId))!.state, 'needs_attention')
    assert.equal((await entitlementsFor(buyer.id)).filter((e) => e.status === 'available').length, 1, 'the digital item is ready regardless')

    fake.refuseCreate = null
    const buyer2 = await signUp('second@example.com')
    const quote = await api('/api/checkout/shipping-quote', { session: buyer2, body: { items: [{ productId: teeId, variantId: small, quantity: 1 }], address: ADDRESS } })
    const co = await api('/api/checkout', { session: buyer2, body: { items: [{ productId: teeId, variantId: small, quantity: 1 }], shipping: { quote_id: quote.data.quoteId, option_id: 'STANDARD' } } })
    const order = (await one<{ id: string; subtotal_cents: number }>('select id, subtotal_cents from orders where order_number = $1', [co.data.orderNumber]))!
    fake.down = true
    await payOrder(order.id, order.subtotal_cents + 475, { amount_subtotal: order.subtotal_cents, total_details: { amount_discount: 0, amount_shipping: 475, amount_tax: 0 } })
    await printfulIdle()
    assert.equal((await job(order.id))!.state, 'uncertain')
    assert.equal(fake.orders.length, 0)
    fake.down = false
    // The owner's "Check with Printful and continue" reconciles first, then sends it.
    const r = await api(`/api/admin/orders/${order.id}/printful/retry`, { session: admin, body: {} })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal((await job(order.id))!.state, 'submitted')
    assert.equal(fake.orders.length, 1)
  })

  it('webhooks are verified, only prompt a fresh read, and bring partial shipments, tracking and one email per shipment', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small, medium } = await linkedTee(admin)
    await openSales(admin, true)
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }, { productId: teeId, variantId: medium }])
    const pf = fake.orders[0]
    const items = await q<{ id: string; variant_id: string }>('select id, variant_id from order_items where order_id = $1', [orderId])
    const smallItem = items.find((i) => i.variant_id === small)!.id
    const mediumItem = items.find((i) => i.variant_id === medium)!.id

    // A forged event (wrong token) is refused; a forged order id in a valid event changes nothing by itself.
    assert.equal((await postWebhook({ type: 'package_shipped', data: { order: { id: pf.id } } }, { token: 'wrong-token-wrong-token-1234' })).status, 401)
    assert.equal((await postWebhook({ type: 'package_shipped', data: { order: { id: pf.id } } }, { token: '' })).status, 401)
    const nothing = await postWebhook({ type: 'package_shipped', data: { order: { id: pf.id }, shipment: { id: 1, tracking_number: 'FAKE' } } })
    assert.equal(nothing.status, 200)
    assert.equal((await api(`/api/admin/orders/${orderId}`, { session: admin })).data.shipments.length, 0, 'the payload alone never creates a shipment')

    fake.ship(pf.id, { id: 7001, items: [{ external_id: smallItem, quantity: 1 }], tracking: '9400111' })
    await postWebhook({ type: 'package_shipped', created: 1, retries: 0, data: { order: { id: pf.id } } })
    await postWebhook({ type: 'package_shipped', created: 1, retries: 1, data: { order: { id: pf.id } } })
    let detail = (await api(`/api/admin/orders/${orderId}`, { session: admin })).data
    assert.equal(detail.shipments.length, 1)
    assert.equal(detail.order.fulfillment_status, 'partially_fulfilled')
    assert.equal(detail.shipments[0].tracking_number, '9400111')
    assert.deepEqual(detail.shipments[0].items.map((i: any) => i.order_item_id), [smallItem])
    const mine = (await api(`/api/account/orders/${detail.order.order_number}`, { session: buyer })).data
    assert.equal(mine.shipments[0].tracking_number, '9400111', 'the customer sees the tracking')

    fake.ship(pf.id, { id: 7002, items: [{ external_id: mediumItem, quantity: 1 }], tracking: '9400222' })
    await postWebhook({ type: 'package_shipped', created: 2, data: { order: { id: pf.id } } })
    detail = (await api(`/api/admin/orders/${orderId}`, { session: admin })).data
    assert.equal(detail.shipments.length, 2)
    assert.equal(detail.order.fulfillment_status, 'fulfilled')
    assert.equal((await one<{ n: number }>(`select count(*)::int as n from emails where type = 'shipping_confirmation' and related_order_id = $1`, [orderId]))!.n, 2, 'one shipping email per shipment, no duplicates')
    // Shipped is not delivered.
    assert.ok(detail.shipments.every((s: any) => s.status === 'shipped' && !s.delivered_at))
  })

  it('signed webhooks are checked with HMAC-SHA256 when a signing secret is set', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    await buy(buyer, [{ productId: teeId, variantId: small }])
    const secret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    config.printful.webhookSecret = secret
    try {
      const body = { type: 'order_updated', data: { order: { id: fake.orders[0].id } } }
      const good = createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(body)).digest('hex')
      assert.equal((await postWebhook(body, { token: '', signature: good })).status, 200)
      assert.equal((await postWebhook({ ...body, x: 1 }, { token: '', signature: good })).status, 401, 'a changed body fails')
      assert.equal((await postWebhook(body, { token: '' })).status, 401, 'a missing signature fails')
    } finally {
      config.printful.webhookSecret = ''
    }
  })

  it('counts delivery only from a Printful delivery time; review requests start 14 days after it', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    await api('/api/admin/automations/physical_review', { session: admin, method: 'PUT', body: { enabled: true } })
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    const { orderId } = await buy(buyer, [{ productId: teeId, variantId: small }])
    const pf = fake.orders[0]
    const item = (await one<{ id: string }>('select id from order_items where order_id = $1', [orderId]))!.id
    fake.ship(pf.id, { id: 7101, items: [{ external_id: item, quantity: 1 }], tracking: 'T1' })
    await postWebhook({ type: 'package_shipped', data: { order: { id: pf.id } } })
    let review = await one<{ status: string; hold_reason: string; due_at: Date | null }>(`select status, hold_reason, due_at from email_jobs where order_id = $1 and kind = 'physical_review'`, [orderId])
    assert.equal(review?.status, 'held')
    assert.equal(review?.hold_reason, 'awaiting_delivery', 'shipped alone never starts the review clock')

    const deliveredAt = Math.floor(Date.now() / 1000) - 3600
    ;(pf.shipments[0] as any).delivered_at = deliveredAt
    await postWebhook({ type: 'order_updated', data: { order: { id: pf.id } } })
    const sh = (await one<{ status: string; delivered_at: Date; delivery_source: string }>('select status, delivered_at, delivery_source from shipments where order_id = $1', [orderId]))!
    assert.equal(sh.status, 'delivered')
    assert.equal(sh.delivery_source, 'printful')
    review = await one(`select status, hold_reason, due_at from email_jobs where order_id = $1 and kind = 'physical_review'`, [orderId])
    assert.equal(review?.status, 'scheduled')
    assert.equal(Math.round((new Date(review!.due_at!).getTime() - deliveredAt * 1000) / 86_400_000), 14)
  })

  it('cancels at Printful only before production, and never refunds the customer by itself', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    const a = await buy(buyer, [{ productId: teeId, variantId: small }])
    const r = await api(`/api/admin/orders/${a.orderId}/printful/cancel`, { session: admin, body: { reason: 'Customer changed their mind' } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(fake.orders[0].status, 'canceled')
    assert.equal((await job(a.orderId))!.state, 'canceled')
    assert.equal((await one<{ status: string }>('select status from orders where id = $1', [a.orderId]))!.status, 'paid', 'the customer refund is a separate step')
    assert.ok(!(await one(`select 1 from emails where type = 'fulfillment_alert' and related_order_id = $1`, [a.orderId])), 'no alert about the owner\'s own cancel')

    const buyer2 = await signUp('second@example.com')
    const b = await buy(buyer2, [{ productId: teeId, variantId: small }])
    fake.orders[1].status = 'inprocess'
    const late = await api(`/api/admin/orders/${b.orderId}/printful/cancel`, { session: admin, body: { reason: 'Too late' } })
    assert.equal(late.status, 400)
    assert.match(late.data.error, /can no longer be canceled/)
    assert.equal(fake.orders[1].status, 'inprocess')
  })

  it('admin checks read the real setup without creating or charging anything, and register the webhook', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await linkedTee(admin)
    const checks = (await api('/api/admin/printful/checks', { session: admin, body: { address: ADDRESS } })).data.checks
    assert.deepEqual(checks.map((c: any) => [c.check, c.ok]), [
      ['Connect with the API token', true],
      ['Read the store products', true],
      ['Check linked items', true],
      ['Quote shipping for a sample address', true],
      ['Estimate an order cost (nothing is created)', true],
      ['Webhook address', false],
    ])
    assert.equal(fake.orders.length, 0, 'no order was created')
    const reg = await api('/api/admin/printful/webhook', { session: admin, body: {} })
    assert.equal(reg.status, 200, JSON.stringify(reg.data))
    assert.equal(reg.data.ours, true)
    assert.ok(!reg.data.url.includes(config.printful.webhookToken), 'the secret part of the address is never shown')
    assert.ok(fake.webhook!.types!.includes('package_shipped'))
  })

  it('opening sales of items that ship needs Printful connected', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    config.printful.apiToken = ''
    try {
      const r = await api('/api/admin/settings/printful', { session: admin, method: 'PUT', body: { physical_sales: true } })
      assert.equal(r.status, 400)
      assert.equal((await api('/api/status')).data.physicalSales.open, false)
    } finally {
      config.printful.apiToken = 'test-printful-token'
    }
    await drainOutbox()
  })

  it('preorders: paid now, the whole order is held (not sent to Printful) until the owner releases it', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const digitalId = await digitalProduct('pre-digital')
    const { teeId, small } = await linkedTee(admin)
    await openSales(admin, true)
    // A date is required, and cannot be in the past.
    const bad = await api('/api/admin/products', { session: admin, body: { title: 'Pre Hat', slug: 'pre-hat', category: 'apparel', type: 'physical', price_cents: 2000, preorder: true } })
    assert.equal(bad.status, 400)
    assert.match(bad.data.error, /ship by/)
    await q(`update products set preorder = true, preorder_ship_by = current_date + 30 where id = $1`, [teeId])
    const shipBy = (await one<{ d: string }>(`select to_char(current_date + 30, 'YYYY-MM-DD') as d`))!.d
    assert.deepEqual((await api('/api/products/pf-tee')).data.product.preorder, { shipBy })

    const a = await buy(buyer, [{ productId: teeId, variantId: small }, { productId: digitalId }])
    assert.match(a.session.line_items.find((l: any) => /Preorder/.test(l.price_data.product_data.name)).price_data.product_data.description, /Ships by/)
    assert.equal(fake.orders.length, 0, 'nothing goes to Printful yet')
    assert.equal((await job(a.orderId))!.state, 'held')
    assert.ok(await one(`select 1 from order_updates where order_id = $1 and message like 'Preorder received%'`, [a.orderId]))
    assert.equal((await one<{ status: string }>(`select e.status from entitlements e join order_items oi on oi.id = e.order_item_id where oi.order_id = $1`, [a.orderId]))!.status, 'available', 'downloads do not wait for preorders')
    const confirmation = await one<{ html: string }>(`select html from emails where type = 'order_confirmation' and related_order_id = $1`, [a.orderId])
    assert.match(confirmation!.html, /preorder, ships by/)
    await runPrintfulQueue()
    assert.equal(fake.orders.length, 0, 'the queue leaves held orders alone')
    assert.equal((await api(`/api/admin/orders/${a.orderId}/printful/retry`, { session: admin, body: {} })).status, 400, 'retry cannot release a preorder by accident')
    const summary = (await api('/api/admin/printful/preorders', { session: admin })).data.preorders
    assert.deepEqual(summary.map((x: any) => [x.title, x.orders, x.items]), [['Test pf-tee', 1, 1]])

    // Release: sent to Printful, confirmed, customer told. Pressing again does nothing more.
    const r = await api(`/api/admin/products/${teeId}/preorders/release`, { session: admin, body: { confirm: true } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.deepEqual(r.data, { sent: 1, stillWaiting: 0 })
    await printfulIdle()
    assert.equal(fake.orders.length, 1)
    assert.equal(fake.orders[0].status, 'pending')
    assert.deepEqual(fake.orders[0].items.map((i) => [i.sync_variant_id, i.quantity]), [[4001, 1]])
    assert.equal((await job(a.orderId))!.state, 'submitted')
    assert.ok(await one(`select 1 from emails where type = 'preorder_released' and related_order_id = $1`, [a.orderId]))
    assert.deepEqual((await api(`/api/admin/products/${teeId}/preorders/release`, { session: admin, body: { confirm: true } })).data, { sent: 0, stillWaiting: 0 })
    await printfulIdle()
    assert.equal(fake.orders.length, 1)
  })

  it('preorders: a regular item waits with the preorder; an order with two preorder products waits for both; release can leave drafts', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const { teeId, small, medium } = await linkedTee(admin)
    const capId = await physicalProduct('pf-cap', 0)
    fake.addProduct(310, [{ id: 4501, variant_id: 15001 }])
    assert.equal((await api(`/api/admin/products/${capId}/printful`, { session: admin, method: 'PUT', body: { sync_product_id: 310, links: [{ variant_id: null, sync_variant_id: 4501 }] } })).status, 200)
    await openSales(admin, true)
    await q(`update products set preorder = true, preorder_ship_by = current_date + 20 where id = $1`, [teeId])

    // Preorder tee + regular cap: the whole order waits (one package).
    const a = await buy(buyer, [{ productId: teeId, variantId: small }, { productId: capId }])
    assert.equal((await job(a.orderId))!.state, 'held')
    // Second order: tee (preorder) + cap, with the cap now a preorder too.
    await q(`update products set preorder = true, preorder_ship_by = current_date + 40 where id = $1`, [capId])
    const buyer2 = await signUp('second@example.com')
    const b = await buy(buyer2, [{ productId: teeId, variantId: medium }, { productId: capId }])
    assert.equal((await job(b.orderId))!.state, 'held')

    const r = await api(`/api/admin/products/${teeId}/preorders/release`, { session: admin, body: { confirm: false } })
    assert.deepEqual(r.data, { sent: 1, stillWaiting: 1 }, 'order b still has the cap preorder waiting')
    await printfulIdle()
    assert.equal(fake.orders.length, 1)
    assert.equal(fake.orders[0].status, 'draft', 'released without confirming: a Printful draft for the owner')
    assert.equal(fake.orders[0].items.length, 2, 'the regular cap ships with the tee')
    assert.equal((await job(b.orderId))!.state, 'held')
    const r2 = await api(`/api/admin/products/${capId}/preorders/release`, { session: admin, body: { confirm: true } })
    assert.deepEqual(r2.data, { sent: 1, stillWaiting: 0 })
    await printfulIdle()
    assert.equal(fake.orders.length, 2)
    assert.equal(fake.orders[1].status, 'pending')
  })
})
