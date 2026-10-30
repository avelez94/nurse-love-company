/*
  Revenue reporting. Metric definitions (also shown in the admin):

  Paid orders      Orders with a confirmed payment whose payment date falls in the
                   range: status paid, partially refunded, refunded or disputed.
  Gross sales      Product revenue before discounts: unit price × quantity for
                   every line on paid orders. Excludes shipping and taxes.
  Discounts        Promotion code and other discounts on those orders.
  Refunds          Money returned to customers by refunds that succeeded during
                   the range (may include refunded shipping or tax).
  Net sales        Gross sales − discounts − refunds.
  Shipping         Shipping charged to customers. Not product revenue.
  Taxes            Sales tax collected. Not revenue; owed to tax authorities.
  Processing fees  Stripe fees, when Stripe has reported them.
  Average order    (Gross sales − discounts) ÷ paid orders. Excludes shipping and tax.
  New customers    Customers whose first ever paid order falls in the range.
  Free claims      Freebie Corner resources claimed at $0. Reported on their own
                   and never counted as paid orders, sales or paying customers.
  Customers        Everyone with a completed order in the range (paid or free),
                   split into paying customers and freebie only customers.

  None of these numbers is profit: product costs, shipping labels, platform
  fees and other expenses are not included.
*/
import { q, one } from '../db/pool.js'

export interface Range {
  from: Date
  to: Date
  includeDemo: boolean
}

const PAID = `('paid','partially_refunded','refunded','disputed')`

async function summary(r: Range) {
  const demo = `${r.includeDemo ? '' : 'and not o.is_demo'} and not o.is_free_claim`
  const params = [r.from.toISOString(), r.to.toISOString()]
  const orders = await one<{ orders: number; discounts: number; shipping: number; tax: number; fees: number; fees_missing: number }>(
    `select count(*)::int as orders, coalesce(sum(discount_cents),0)::int as discounts, coalesce(sum(shipping_cents),0)::int as shipping,
            coalesce(sum(tax_cents),0)::int as tax, coalesce(sum(fee_cents),0)::int as fees, count(*) filter (where fee_cents is null)::int as fees_missing
       from orders o where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo}`,
    params,
  )
  const lines = await one<{ gross: number; digital: number; physical: number }>(
    `select coalesce(sum(oi.unit_price_cents * oi.quantity),0)::int as gross,
            coalesce(sum(oi.unit_price_cents * oi.quantity) filter (where oi.product_type = 'digital'),0)::int as digital,
            coalesce(sum(oi.unit_price_cents * oi.quantity) filter (where oi.product_type = 'physical'),0)::int as physical
       from order_items oi join orders o on o.id = oi.order_id
      where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo}`,
    params,
  )
  const refunds = await one<{ refunds: number }>(
    `select coalesce(sum(r.amount_cents),0)::int as refunds from refunds r join orders o on o.id = r.order_id
      where r.status = 'succeeded' and r.created_at >= $1 and r.created_at < $2 ${demo}`,
    params,
  )
  const customers = await one<{ new_customers: number; returning_customers: number }>(
    `with buyers as (
       select distinct o.user_id from orders o where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 and o.user_id is not null ${demo}
     ), firsts as (
       select o.user_id, min(o.paid_at) as first_paid from orders o where o.status in ${PAID} and o.user_id in (select user_id from buyers) group by o.user_id
     )
     select count(*) filter (where first_paid >= $1)::int as new_customers, count(*) filter (where first_paid < $1)::int as returning_customers from firsts`,
    params,
  )
  const o = orders!
  const gross = lines!.gross
  const net = gross - o.discounts - refunds!.refunds
  return {
    grossSales: gross,
    discounts: o.discounts,
    refunds: refunds!.refunds,
    netSales: net,
    shipping: o.shipping,
    taxes: o.tax,
    processingFees: o.fees,
    feesMissingFor: o.fees_missing,
    orders: o.orders,
    averageOrderValue: o.orders ? Math.round((gross - o.discounts) / o.orders) : 0,
    digitalSales: lines!.digital,
    physicalSales: lines!.physical,
    newCustomers: customers!.new_customers,
    returningCustomers: customers!.returning_customers,
  }
}

export async function revenueReport(r: Range) {
  const span = r.to.getTime() - r.from.getTime()
  const prev: Range = { from: new Date(r.from.getTime() - span), to: new Date(r.from.getTime()), includeDemo: r.includeDemo }
  const demo = `${r.includeDemo ? '' : 'and not o.is_demo'} and not o.is_free_claim`
  const demoAll = r.includeDemo ? '' : 'and not o.is_demo'
  const params = [r.from.toISOString(), r.to.toISOString()]
  const [current, previous, byProduct, byCategory, recent, lowStock, daily] = await Promise.all([
    summary(r),
    summary(prev),
    q(
      `select oi.product_id, max(oi.title_snapshot) as title, max(oi.product_type) as type, sum(oi.quantity)::int as units, sum(oi.unit_price_cents * oi.quantity)::int as gross
         from order_items oi join orders o on o.id = oi.order_id
        where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo} and not oi.is_freebie
        group by oi.product_id order by gross desc limit 50`,
      params,
    ),
    q(
      `select oi.category_snapshot as category, sum(oi.quantity)::int as units, sum(oi.unit_price_cents * oi.quantity)::int as gross
         from order_items oi join orders o on o.id = oi.order_id
        where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo} and not oi.is_freebie
        group by oi.category_snapshot order by gross desc`,
      params,
    ),
    q(
      `select o.id, o.order_number, o.customer_name, o.email, o.status, o.fulfillment_status, o.total_cents, o.created_at, o.is_demo, o.is_free_claim
         from orders o where o.status <> 'pending' ${demoAll} order by o.created_at desc limit 8`,
    ),
    q(
      `select p.id as product_id, null as variant_id, p.title, p.inventory_quantity as stock, p.low_stock_threshold as threshold
         from products p where p.type = 'physical' and p.active and p.archived_at is null
          and not exists (select 1 from product_variants v where v.product_id = p.id and v.active) and p.inventory_quantity <= p.low_stock_threshold
       union all
       select p.id, v.id, p.title || ' (' || v.title || ')', v.inventory_quantity, p.low_stock_threshold
         from product_variants v join products p on p.id = v.product_id
        where v.active and p.active and p.archived_at is null and v.inventory_quantity <= p.low_stock_threshold
       order by stock asc limit 20`,
    ),
    q(
      `select date_trunc('day', o.paid_at) as day, sum(oi.unit_price_cents * oi.quantity)::int as gross
         from order_items oi join orders o on o.id = oi.order_id
        where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo}
        group by 1 order by 1`,
      params,
    ),
  ])
  // Free claims, reported on their own (not sales).
  const freeClaims = await one<{ claims: number; customers: number }>(
    `select count(*)::int as claims, count(distinct o.user_id)::int as customers from order_items oi join orders o on o.id = oi.order_id
      where oi.is_freebie and o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demoAll}`,
    params,
  )
  const people = await one<{ total: number; paying: number }>(
    `select count(distinct o.user_id)::int as total, count(distinct o.user_id) filter (where not o.is_free_claim)::int as paying
       from orders o where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 and o.user_id is not null ${demoAll}`,
    params,
  )
  const customers = { total: people!.total, paying: people!.paying, freebieOnly: people!.total - people!.paying }
  return { range: { from: r.from, to: r.to }, previousRange: { from: prev.from, to: prev.to }, current, previous, byProduct, byCategory, recentOrders: recent, lowStock, daily, freeClaims, customers }
}

/** CSV with protection against spreadsheet formula injection. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<[string, string]>) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(([, label]) => cell(label)).join(','), ...rows.map((r) => columns.map(([key]) => cell(r[key])).join(','))].join('\r\n') + '\r\n'
}

const dollars = (c: unknown) => (c === null || c === undefined ? '' : (Number(c) / 100).toFixed(2))

export async function ordersCsv(r: Range) {
  const demo = r.includeDemo ? '' : 'and not o.is_demo'
  const rows = await q<Record<string, unknown>>(
    `select o.order_number, o.created_at, o.paid_at, o.customer_name, o.email, o.status, o.fulfillment_status, o.subtotal_cents, o.discount_cents, o.shipping_cents, o.tax_cents,
            o.total_cents, o.refunded_cents, o.fee_cents, o.stripe_payment_intent_id, o.is_demo, o.is_free_claim
       from orders o where o.created_at >= $1 and o.created_at < $2 ${demo} order by o.created_at`,
    [r.from.toISOString(), r.to.toISOString()],
  )
  const mapped = rows.map((x) => ({ ...x, subtotal: dollars(x.subtotal_cents), discount: dollars(x.discount_cents), shipping: dollars(x.shipping_cents), tax: dollars(x.tax_cents), total: dollars(x.total_cents), refunded: dollars(x.refunded_cents), fee: dollars(x.fee_cents), demo: x.is_demo ? 'yes' : 'no', kind: x.is_free_claim ? 'Free claim' : 'Paid order' }))
  return toCsv(mapped, [
    ['order_number', 'Order'], ['created_at', 'Created'], ['paid_at', 'Paid'], ['customer_name', 'Customer'], ['email', 'Email'], ['status', 'Payment status'], ['fulfillment_status', 'Fulfillment'],
    ['subtotal', 'Subtotal (USD)'], ['discount', 'Discounts'], ['shipping', 'Shipping'], ['tax', 'Tax'], ['total', 'Total charged'], ['refunded', 'Refunded'], ['fee', 'Processing fee'], ['stripe_payment_intent_id', 'Payment reference'], ['demo', 'Demo data'], ['kind', 'Type'],
  ])
}

export async function salesCsv(r: Range) {
  const demo = `${r.includeDemo ? '' : 'and not o.is_demo'} and not o.is_free_claim`
  const rows = await q<Record<string, unknown>>(
    `select o.order_number, o.paid_at, oi.title_snapshot, oi.variant_snapshot, oi.sku_snapshot, oi.category_snapshot, oi.product_type, oi.quantity, oi.unit_price_cents,
            oi.unit_price_cents * oi.quantity as gross_cents, oi.refunded_quantity, o.is_demo
       from order_items oi join orders o on o.id = oi.order_id
      where o.status in ${PAID} and o.paid_at >= $1 and o.paid_at < $2 ${demo} and not oi.is_freebie order by o.paid_at`,
    [r.from.toISOString(), r.to.toISOString()],
  )
  const mapped = rows.map((x) => ({ ...x, unit: dollars(x.unit_price_cents), gross: dollars(x.gross_cents), demo: x.is_demo ? 'yes' : 'no' }))
  return toCsv(mapped, [
    ['order_number', 'Order'], ['paid_at', 'Paid'], ['title_snapshot', 'Product'], ['variant_snapshot', 'Variant'], ['sku_snapshot', 'SKU'], ['category_snapshot', 'Category'], ['product_type', 'Type'],
    ['quantity', 'Quantity'], ['unit', 'Unit price (USD)'], ['gross', 'Gross sales (USD)'], ['refunded_quantity', 'Refunded quantity'], ['demo', 'Demo data'],
  ])
}
