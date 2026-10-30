/*
  Orders, checkout and payment events.

  * Prices are always taken from the database on the server, never from the browser.
  * Orders are created as "pending" and only become "paid" after a verified
    Stripe webhook. Downloads are granted only then.
  * Every webhook event is stored once by its Stripe id, so repeats are no-ops.
  * Each order keeps a snapshot of product names, prices and addresses, so
    receipts never change when listings or customer addresses change later.
*/
import type { PoolClient } from 'pg'
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { kickDispatcher, queueEmail } from '../email/outbox.js'
import { config, paymentsState } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import { stripe, type Stripe } from '../lib/stripe.js'
import { applyRefundToEntitlements, grantPurchaseEntitlements } from './entitlements.js'
import { getSettings } from './settings.js'

export interface CartLine {
  productId: string
  variantId?: string | null
  quantity: number
}

export const money = (cents: number, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

interface PricedLine {
  product_id: string
  variant_id: string | null
  product_type: 'digital' | 'physical'
  title: string
  variant_title: string
  sku: string
  category: string
  unit_price_cents: number
  quantity: number
}

/** Validates a cart against live product data. Used for checkout and the cart preview. */
export async function priceCart(user: SessionUser | null, lines: CartLine[], client?: PoolClient): Promise<PricedLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) throw badRequest('Your bag is empty.')
  if (lines.length > 25) throw badRequest('Too many different items in one order.')
  const out: PricedLine[] = []
  const seen = new Set<string>()
  for (const l of lines) {
    const key = `${l.productId}:${l.variantId ?? ''}`
    if (seen.has(key)) throw badRequest('The same item appears twice in your bag.')
    seen.add(key)
    const p = await one<{ id: string; title: string; type: 'digital' | 'physical'; category: string; price_cents: number | null; sale_price_cents: number | null; status: string; active: boolean; archived_at: string | null; sku: string | null; inventory_quantity: number; out_of_stock_behavior: string; current_version_id: string | null }>(
      'select * from products where id = $1',
      [l.productId],
      client,
    )
    if (!p || p.status !== 'published' || !p.active || p.archived_at) throw badRequest('One of the items in your bag is no longer available. Please remove it and try again.')
    if ((p as { is_demo?: boolean }).is_demo && paymentsState() !== 'test') throw badRequest(`${p.title} is demo content and can only be bought with Stripe test cards.`)
    const qty = Number(l.quantity)
    if (!Number.isInteger(qty) || qty < 1) throw badRequest(`Please choose a quantity for ${p.title}.`)
    let price = p.sale_price_cents ?? p.price_cents
    let variantTitle = ''
    let sku = p.sku ?? ''
    if (p.type === 'digital') {
      // One download per purchase: digital items are always quantity one.
      if (qty !== 1) throw badRequest(`${p.title} is a digital download and can only be purchased once per order.`)
      if (l.variantId) throw badRequest('Digital products do not have variants.')
      if (user) {
        const owned = await one(
          `select 1 from order_items oi join orders o on o.id = oi.order_id
            where o.user_id = $1 and oi.product_id = $2 and o.status in ('paid','partially_refunded','disputed') and oi.refunded_quantity < oi.quantity`,
          [user.id, p.id],
          client,
        )
        if (owned) throw conflict(`You already own ${p.title}. You can find it in My Downloads.`, 'already_owned')
      }
    } else {
      if (qty > 10) throw badRequest(`You can order up to 10 of ${p.title}.`)
      const variants = await q<{ id: string; title: string; sku: string | null; price_cents: number | null; inventory_quantity: number; active: boolean }>('select * from product_variants where product_id = $1 and active', [p.id], client)
      let stock = p.inventory_quantity
      if (variants.length) {
        const v = variants.find((x) => x.id === l.variantId)
        if (!v) throw badRequest(`Please choose an option for ${p.title}.`)
        variantTitle = v.title
        sku = v.sku ?? sku
        if (v.price_cents !== null) price = v.price_cents
        stock = v.inventory_quantity
      } else if (l.variantId) throw badRequest('That option is not available.')
      if (p.out_of_stock_behavior !== 'allow_backorder' && stock < qty) {
        throw conflict(stock <= 0 ? `${p.title}${variantTitle ? ` (${variantTitle})` : ''} is sold out.` : `Only ${stock} of ${p.title} left in stock.`, 'out_of_stock')
      }
    }
    if (price === null || price === undefined) throw badRequest(`${p.title} is not available for purchase yet.`)
    out.push({ product_id: p.id, variant_id: l.variantId ?? null, product_type: p.type, title: p.title, variant_title: variantTitle, sku, category: p.category, unit_price_cents: price, quantity: qty })
  }
  return out
}

/** Creates a pending order and a Stripe Checkout Session in test mode. */
export async function createCheckout(user: SessionUser, lines: CartLine[]) {
  const s = stripe() // throws a clear 503 when payments are not configured
  const settings = await getSettings()
  const priced = await priceCart(user, lines)
  const hasPhysical = priced.some((l) => l.product_type === 'physical')
  if (hasPhysical && (!settings.shipping.configured || settings.shipping.flat_rate_cents === null)) {
    throw new HttpError(503, 'Shipping rates have not been set up yet, so items that ship cannot be purchased right now.', 'shipping_not_configured')
  }
  const subtotal = priced.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)

  const order = await tx(async (client) => {
    const o = await one<{ id: string; order_number: string }>(
      `insert into orders (user_id, email, customer_name, status, fulfillment_status, subtotal_cents, total_cents)
       values ($1,$2,$3,'pending',$4,$5,$5) returning id, order_number`,
      [user.id, user.email, user.name, hasPhysical ? 'unfulfilled' : 'not_required', subtotal],
      client,
    )
    for (const l of priced) {
      await q(
        `insert into order_items (order_id, product_id, variant_id, product_type, title_snapshot, variant_snapshot, sku_snapshot, category_snapshot, unit_price_cents, quantity, line_total_cents)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [o!.id, l.product_id, l.variant_id, l.product_type, l.title, l.variant_title, l.sku, l.category, l.unit_price_cents, l.quantity, l.unit_price_cents * l.quantity],
        client,
      )
    }
    return o!
  })

  const freeShipping = settings.shipping.free_over_cents !== null && subtotal >= settings.shipping.free_over_cents
  const session = await s.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: user.email,
      client_reference_id: order.id,
      metadata: { order_id: order.id, order_number: order.order_number },
      payment_intent_data: { metadata: { order_id: order.id, order_number: order.order_number } },
      line_items: priced.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: l.unit_price_cents,
          product_data: { name: l.variant_title ? `${l.title} (${l.variant_title})` : l.title, metadata: { product_id: l.product_id, type: l.product_type } },
        },
      })),
      allow_promotion_codes: true,
      automatic_tax: { enabled: settings.payments.automatic_tax },
      ...(hasPhysical
        ? {
            shipping_address_collection: { allowed_countries: settings.shipping.countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
            shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: 'Standard shipping', fixed_amount: { amount: freeShipping ? 0 : settings.shipping.flat_rate_cents!, currency: 'usd' } } }],
          }
        : {}),
      success_url: `${config.appUrl}/#checkout-success`,
      cancel_url: `${config.appUrl}/#checkout-canceled`,
    },
    { idempotencyKey: `checkout:${order.id}` },
  )
  await q('update orders set stripe_checkout_session_id = $2, updated_at = now() where id = $1', [order.id, session.id])
  return { url: session.url, orderNumber: order.order_number }
}

/* ---------- Stripe events ---------- */

export async function handleStripeEvent(event: Stripe.Event): Promise<'processed' | 'duplicate' | 'ignored'> {
  const stored = await one<{ status: string }>(
    `insert into payment_events (id, type, payload) values ($1,$2,$3)
     on conflict (id) do update set id = excluded.id returning status`,
    [event.id, event.type, JSON.stringify(event)],
  )
  if (stored && (stored.status === 'processed' || stored.status === 'ignored')) return 'duplicate'

  try {
    let outcome: 'processed' | 'ignored' = 'processed'
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') await markPaid(session)
        else outcome = 'ignored' // Async payment still processing; a later event will settle it.
        break
      }
      case 'checkout.session.async_payment_failed':
        await markUnpaid(event.data.object as Stripe.Checkout.Session, 'failed')
        break
      case 'checkout.session.expired':
        await markUnpaid(event.data.object as Stripe.Checkout.Session, 'canceled')
        break
      case 'charge.refunded':
        await syncRefunds(event.data.object as Stripe.Charge)
        break
      case 'charge.dispute.created':
      case 'charge.dispute.closed':
        await syncDispute(event.data.object as Stripe.Dispute, event.type)
        break
      default:
        outcome = 'ignored'
    }
    await q('update payment_events set status = $2, processed_at = now(), error = null where id = $1', [event.id, outcome])
    kickDispatcher()
    return outcome
  } catch (err) {
    await q('update payment_events set status = $2, error = $3 where id = $1', [event.id, 'failed', (err as Error).message])
    throw err
  }
}

function orderIdFrom(session: Stripe.Checkout.Session) {
  return session.metadata?.order_id ?? session.client_reference_id ?? null
}

async function markPaid(session: Stripe.Checkout.Session) {
  const orderId = orderIdFrom(session)
  if (!orderId) throw new Error(`Checkout session ${session.id} has no order reference`)
  const paidOrderId = await tx(async (client) => {
    const order = await one<{ id: string; status: string; subtotal_cents: number; order_number: string; user_id: string | null; email: string; customer_name: string; is_demo: boolean }>('select * from orders where id = $1 for update', [orderId], client)
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (order.status !== 'pending' && order.status !== 'failed' && order.status !== 'canceled') return null // already settled: nothing to do

    const td = session.total_details
    const ship = session.collected_information?.shipping_details ?? null
    await q(
      `update orders set status = 'paid', paid_at = now(), updated_at = now(),
         subtotal_cents = $2, discount_cents = $3, shipping_cents = $4, tax_cents = $5, total_cents = $6,
         billing_details = $7, shipping_address = $8, stripe_payment_intent_id = $9, stripe_checkout_session_id = $10
       where id = $1`,
      [
        order.id,
        session.amount_subtotal ?? order.subtotal_cents,
        td?.amount_discount ?? 0,
        td?.amount_shipping ?? 0,
        td?.amount_tax ?? 0,
        session.amount_total ?? order.subtotal_cents,
        JSON.stringify({ name: session.customer_details?.name ?? '', email: session.customer_details?.email ?? order.email, address: session.customer_details?.address ?? null }),
        ship ? JSON.stringify({ name: ship.name, address: ship.address }) : null,
        typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
        session.id,
      ],
      client,
    )
    if (session.amount_subtotal !== null && session.amount_subtotal !== order.subtotal_cents) {
      await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,'system')`, [order.id, `Payment subtotal (${money(session.amount_subtotal)}) did not match the order subtotal (${money(order.subtotal_cents)}). Please review.`], client)
    }

    // Inventory for physical items.
    const items = await q<{ id: string; product_id: string; variant_id: string | null; product_type: string; quantity: number; title_snapshot: string }>('select * from order_items where order_id = $1', [order.id], client)
    for (const it of items.filter((i) => i.product_type === 'physical')) {
      const left = it.variant_id
        ? await one<{ n: number }>('update product_variants set inventory_quantity = inventory_quantity - $2 where id = $1 returning inventory_quantity as n', [it.variant_id, it.quantity], client)
        : await one<{ n: number }>('update products set inventory_quantity = inventory_quantity - $2 where id = $1 returning inventory_quantity as n', [it.product_id, it.quantity], client)
      if (left && left.n < 0) await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,'system')`, [order.id, `${it.title_snapshot} is now oversold (stock ${left.n}).`], client)
    }

    await grantPurchaseEntitlements(order.id, client)
    await q(`insert into order_updates (order_id, message, created_by) values ($1,'Payment received. Thank you for your order!','system')`, [order.id], client)

    const name = session.customer_details?.name || order.customer_name
    const to = order.email
    await queueEmail(
      {
        type: 'order_confirmation',
        to,
        userId: order.user_id,
        orderId: order.id,
        isDemo: order.is_demo,
        vars: { name, order_number: order.order_number, order_total: money(session.amount_total ?? 0) },
        rows: items.map((i) => [`${i.title_snapshot} × ${i.quantity}`, '']) as Array<[string, string]>,
        idempotencyKey: `order_confirmation:${order.id}`,
      },
      client,
    )
    const digital = items.filter((i) => i.product_type === 'digital')
    if (digital.length) {
      await queueEmail(
        {
          type: 'digital_available',
          to,
          userId: order.user_id,
          orderId: order.id,
          isDemo: order.is_demo,
          vars: { name, order_number: order.order_number, product_list: digital.map((d) => d.title_snapshot).join(', ') },
          idempotencyKey: `digital_available:${order.id}`,
        },
        client,
      )
    }
    return order.id
  })
  if (paidOrderId) void recordFee(paidOrderId)
}

/** Payment processing fee from Stripe's balance transaction, when available. */
async function recordFee(orderId: string) {
  try {
    const o = await one<{ stripe_payment_intent_id: string | null }>('select stripe_payment_intent_id from orders where id = $1', [orderId])
    if (!o?.stripe_payment_intent_id) return
    const pi = await stripe().paymentIntents.retrieve(o.stripe_payment_intent_id, { expand: ['latest_charge.balance_transaction'] })
    const charge = pi.latest_charge as Stripe.Charge | null
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null
    if (bt && typeof bt.fee === 'number') await q('update orders set fee_cents = $2 where id = $1', [orderId, bt.fee])
  } catch {
    /* fees are optional; reports show "not available" */
  }
}

async function markUnpaid(session: Stripe.Checkout.Session, status: 'failed' | 'canceled') {
  const orderId = orderIdFrom(session)
  if (!orderId) return
  await q(`update orders set status = $2, canceled_at = case when $2 = 'canceled' then now() else canceled_at end, updated_at = now() where id = $1 and status = 'pending'`, [orderId, status])
}

async function orderForCharge(client: PoolClient, charge: { payment_intent: string | Stripe.PaymentIntent | null; metadata?: Record<string, string> }) {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (pi) {
    const o = await one<{ id: string; total_cents: number; status: string; refunded_cents: number }>('select * from orders where stripe_payment_intent_id = $1 for update', [pi], client)
    if (o) return o
  }
  const id = charge.metadata?.order_id
  return id ? one<{ id: string; total_cents: number; status: string; refunded_cents: number }>('select * from orders where id = $1 for update', [id], client) : null
}

/** Applies a refund row's line items exactly once (on its first transition to succeeded). */
async function applyRefundRow(client: PoolClient, refundId: string) {
  const r = await one<{ order_id: string; items: Array<{ order_item_id: string; quantity: number }>; restock: boolean }>(
    `update refunds set status = 'succeeded' where id = $1 and status <> 'succeeded' returning order_id, items, restock`,
    [refundId],
    client,
  )
  if (!r) return
  for (const it of r.items) {
    const row = await one<{ product_id: string; variant_id: string | null; product_type: string }>(
      'update order_items set refunded_quantity = least(quantity, refunded_quantity + $2) where id = $1 and order_id = $3 returning product_id, variant_id, product_type',
      [it.order_item_id, it.quantity, r.order_id],
      client,
    )
    if (row && r.restock && row.product_type === 'physical') {
      if (row.variant_id) await q('update product_variants set inventory_quantity = inventory_quantity + $2 where id = $1', [row.variant_id, it.quantity], client)
      else await q('update products set inventory_quantity = inventory_quantity + $2 where id = $1', [row.product_id, it.quantity], client)
    }
  }
}

async function syncRefunds(charge: Stripe.Charge) {
  await tx(async (client) => {
    const order = await orderForCharge(client, charge)
    if (!order) throw new Error(`No order for charge ${charge.id}`)
    const settings = await getSettings(client)
    const refunds = charge.refunds?.data ?? []
    for (const rf of refunds) {
      const known = await one<{ id: string }>('select id from refunds where stripe_refund_id = $1', [rf.id], client)
      const rowId =
        known?.id ??
        (await one<{ id: string }>(
          `insert into refunds (order_id, amount_cents, reason, stripe_refund_id, status, created_by) values ($1,$2,$3,$4,'pending','stripe') returning id`,
          [order.id, rf.amount, rf.reason ?? 'Refunded in Stripe', rf.id],
          client,
        ))!.id
      if (rf.status === 'succeeded') await applyRefundRow(client, rowId)
      else if (rf.status === 'failed' || rf.status === 'canceled') await q('update refunds set status = $2, failure_reason = $3 where id = $1', [rowId, rf.status, rf.failure_reason ?? ''], client)
    }
    const refunded = charge.amount_refunded
    const full = refunded >= order.total_cents
    if (full) await q('update order_items set refunded_quantity = quantity where order_id = $1', [order.id], client)
    await q(`update orders set refunded_cents = $2, status = $3, updated_at = now() where id = $1`, [order.id, refunded, full ? 'refunded' : refunded > 0 ? 'partially_refunded' : order.status], client)
    await applyRefundToEntitlements(order.id, settings.policies.refund_download_policy, client)
    await q(`insert into order_updates (order_id, message, customer_visible, created_by) values ($1,$2,true,'system')`, [order.id, full ? 'Your order was refunded.' : `A refund of ${money(refunded)} was issued.`], client)
  })
}

async function syncDispute(dispute: Stripe.Dispute, type: string) {
  await tx(async (client) => {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id
    const order = pi ? await one<{ id: string; status: string; refunded_cents: number }>('select * from orders where stripe_payment_intent_id = $1 for update', [pi], client) : null
    if (!order) throw new Error(`No order for dispute ${dispute.id}`)
    if (type === 'charge.dispute.created') {
      await q(`update orders set status = 'disputed', updated_at = now() where id = $1`, [order.id], client)
      await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,'system')`, [order.id, `Payment dispute opened (${dispute.reason}). New downloads are paused while it is open.`], client)
    } else {
      const won = dispute.status === 'won'
      if (won) await q(`update orders set status = $2, updated_at = now() where id = $1`, [order.id, order.refunded_cents > 0 ? 'partially_refunded' : 'paid'], client)
      await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,'system')`, [order.id, `Payment dispute closed: ${dispute.status}.${won ? '' : ' Downloads stay paused. Decide next steps under your approved policy.'}`], client)
    }
  })
}

/* ---------- Admin order actions ---------- */

export interface RefundRequest {
  items: Array<{ order_item_id: string; quantity: number }>
  amount_cents: number
  reason: string
  restock: boolean
  idempotencyKey: string
}

/** Starts a refund through Stripe. The refund is applied when Stripe confirms it. */
export async function requestRefund(actor: SessionUser, orderId: string, r: RefundRequest, ip?: string) {
  const order = await one<{ id: string; is_demo: boolean; stripe_payment_intent_id: string | null; total_cents: number; refunded_cents: number; status: string; order_number: string }>('select * from orders where id = $1', [orderId])
  if (!order) throw notFound('Order')
  if (order.is_demo) throw badRequest('Demo orders are not connected to a payment, so they cannot be refunded.')
  if (!['paid', 'partially_refunded'].includes(order.status)) throw badRequest('Only paid orders can be refunded.')
  if (!order.stripe_payment_intent_id) throw badRequest('This order has no payment reference to refund.')
  const remaining = order.total_cents - order.refunded_cents
  if (!Number.isInteger(r.amount_cents) || r.amount_cents < 1 || r.amount_cents > remaining) throw badRequest(`Refund amount must be between $0.01 and ${money(remaining)}.`)
  for (const it of r.items) {
    const row = await one<{ quantity: number; refunded_quantity: number }>('select quantity, refunded_quantity from order_items where id = $1 and order_id = $2', [it.order_item_id, orderId])
    if (!row || it.quantity < 1 || it.quantity > row.quantity - row.refunded_quantity) throw badRequest('One of the refund quantities is not valid.')
  }
  const s = stripe()
  const inserted = await one<{ id: string; stripe_refund_id: string | null }>(
    `insert into refunds (order_id, amount_cents, reason, items, restock, idempotency_key, created_by) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id, stripe_refund_id`,
    [orderId, r.amount_cents, r.reason, JSON.stringify(r.items), r.restock, r.idempotencyKey, actor.email],
  )
  if (inserted!.stripe_refund_id) return inserted // repeated click
  try {
    const refund = await s.refunds.create({ payment_intent: order.stripe_payment_intent_id, amount: r.amount_cents, metadata: { order_id: orderId, refund_row_id: inserted!.id } }, { idempotencyKey: `refund:${inserted!.id}` })
    await q('update refunds set stripe_refund_id = $2 where id = $1', [inserted!.id, refund.id])
    await audit({ actor, action: 'order.refund_requested', entityType: 'order', entityId: orderId, summary: `Requested a ${money(r.amount_cents)} refund for ${order.order_number}. Reason: ${r.reason || 'none given'}`, data: { refundId: inserted!.id, stripeRefundId: refund.id, items: r.items, restock: r.restock }, ip })
    return { id: inserted!.id, stripe_refund_id: refund.id, status: refund.status }
  } catch (err) {
    await q(`update refunds set status = 'failed', failure_reason = $2 where id = $1`, [inserted!.id, (err as Error).message])
    throw new HttpError(502, `Stripe could not create the refund: ${(err as Error).message}`, 'refund_failed')
  }
}

export async function addShipment(actor: SessionUser, orderId: string, input: { carrier: string; tracking_number: string; tracking_url: string; status: string; notify: boolean; partial: boolean }, ip?: string) {
  const result = await tx(async (client) => {
    const order = await one<{ id: string; order_number: string; email: string; customer_name: string; user_id: string | null; status: string; is_demo: boolean }>('select * from orders where id = $1 for update', [orderId], client)
    if (!order) throw notFound('Order')
    if (!['paid', 'partially_refunded'].includes(order.status)) throw badRequest('Only paid orders can be fulfilled.')
    const hasPhysical = await one('select 1 from order_items where order_id = $1 and product_type = $2', [orderId, 'physical'], client)
    if (!hasPhysical) throw badRequest('This order has no items that ship.')
    const sh = await one<{ id: string }>(
      `insert into shipments (order_id, carrier, tracking_number, tracking_url, status, shipped_at, created_by) values ($1,$2,$3,$4,$5, now(), $6) returning id`,
      [orderId, input.carrier, input.tracking_number, input.tracking_url, input.status, actor.email],
      client,
    )
    await q(`update orders set fulfillment_status = $2, updated_at = now() where id = $1`, [orderId, input.partial ? 'partially_fulfilled' : 'fulfilled'], client)
    await q(`insert into order_updates (order_id, message, created_by) values ($1,$2,$3)`, [orderId, `Shipped${input.carrier ? ` with ${input.carrier}` : ''}${input.tracking_number ? `. Tracking number ${input.tracking_number}` : ''}.`, actor.email], client)
    if (input.notify) {
      await queueEmail(
        {
          type: 'shipping_confirmation',
          to: order.email,
          userId: order.user_id,
          orderId,
          isDemo: order.is_demo,
          vars: { name: order.customer_name, order_number: order.order_number, carrier: input.carrier || 'our carrier', tracking_number: input.tracking_number || 'not provided' },
          idempotencyKey: `shipping_confirmation:${sh!.id}`,
        },
        client,
      )
    }
    await audit({ actor, action: 'order.fulfilled', entityType: 'order', entityId: orderId, summary: `Marked ${order.order_number} as ${input.partial ? 'partially fulfilled' : 'fulfilled'}${input.tracking_number ? ` (tracking ${input.tracking_number})` : ''}`, data: { shipmentId: sh!.id, ...input }, ip }, client)
    return sh
  })
  kickDispatcher()
  return result
}
