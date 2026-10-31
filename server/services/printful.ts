/*
  Printful fulfillment. Printful makes and ships every physical product; the
  store never stocks, packs or ships anything itself.

  * Products: each sellable physical item is linked by the owner to one
    exact Printful sync variant (its approved design). Nothing is guessed.
    Availability comes from Printful and is refreshed regularly and before
    every shipping quote. Unlinked or unavailable items cannot be bought.
  * Checkout: the customer enters their address first; Printful quotes the
    real shipping options for the real items; the customer picks one and
    pays exactly that in Stripe. Digital items never add shipping.
  * Fulfillment: a verified Stripe payment creates one job per order (the
    order id is the key, so repeated events and overlapping workers cannot
    duplicate it). The job reconciles with Printful by external id before
    every create, so a timed out request is never sent twice, then confirms
    the order for production when automatic confirmation is on. Anything
    Printful refuses, or a failed charge, marks the order as needing
    attention and emails the admins. Nothing is ever shown as shipped
    without Printful's own shipment.
  * Tracking: Printful webhooks only prompt a fresh read of the order from
    Printful's API (their contents are never trusted alone), and the hourly
    job polls active orders in case a webhook is missed. Shipments, partial
    shipments and tracking come from that read. Delivery counts only when
    Printful reports a delivery time; shipped is never treated as delivered.
*/
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import type { PoolClient } from 'pg'
import type { SessionUser } from '../auth.js'
import { one, q, tx, type Queryable } from '../db/pool.js'
import { kickDispatcher, queueEmail } from '../email/outbox.js'
import { config, paymentsState } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import {
  AVAILABLE_STATUSES,
  printful,
  printfulConfigured,
  PrintfulError,
  PrintfulUncertain,
  type PfOrder,
  type PfShipment,
  type PfShippingRate,
  type PfStore,
  type PfSyncProductSummary,
  type PfSyncVariant,
} from '../lib/printful.js'
import { ingestDeliveryEvent } from './delivery.js'
import { getSettings } from './settings.js'

const money = (cents: number) => (cents / 100).toFixed(2)
const QUOTE_MINUTES = 30
/** A link checked more recently than this is trusted at checkout without asking Printful again. */
const FRESH_MS = 10 * 60_000
const LEASE_MS = 5 * 60_000
const MAX_UNCERTAIN_ATTEMPTS = 8

/* ---------- Readiness ---------- */

/** Whether items that ship can be ordered right now, and if not, a plain reason for the customer. */
export async function physicalSales(): Promise<{ open: boolean; reason: string }> {
  if (!printfulConfigured()) return { open: false, reason: 'Items that ship are not available to order yet. Our print partner is still being connected.' }
  const s = await getSettings()
  if (!s.printful.physical_sales) return { open: false, reason: 'Items that ship are not available to order yet. Please check back soon.' }
  return { open: true, reason: '' }
}

/* ---------- Links between store items and Printful sync variants ---------- */

interface LinkRow {
  id: string
  product_id: string
  variant_id: string | null
  sync_product_id: string
  sync_variant_id: string
  catalog_variant_id: string | null
  name: string
  size: string
  color: string
  availability: string
  synced: boolean
  ignored: boolean
  files_ready: boolean
  checked_at: string | null
  check_error: string
}

export const linkAvailable = (l: Pick<LinkRow, 'availability' | 'synced' | 'ignored' | 'files_ready'>) => AVAILABLE_STATUSES.has(l.availability) && l.synced && !l.ignored && l.files_ready

/** Why a linked item cannot be made right now, in the owner's terms. Empty when it can. */
export function linkProblem(l: Pick<LinkRow, 'availability' | 'synced' | 'ignored' | 'files_ready' | 'check_error'>) {
  if (l.check_error) return l.check_error
  if (!l.synced) return 'Not fully set up in Printful yet (not synced).'
  if (l.ignored) return 'Marked as ignored in Printful.'
  if (!l.files_ready) return 'Printful has no approved print file for it.'
  if (!AVAILABLE_STATUSES.has(l.availability)) return l.availability === 'unknown' ? 'Not checked with Printful yet.' : `Printful reports it as ${l.availability.replace(/_/g, ' ')}.`
  return ''
}

function variantFacts(v: PfSyncVariant) {
  const files = v.files ?? []
  return {
    catalog_variant_id: v.variant_id ?? v.product?.variant_id ?? null,
    name: String(v.name ?? ''),
    size: String(v.size ?? ''),
    color: String(v.color ?? ''),
    sku: String(v.sku ?? ''),
    availability: String(v.availability_status ?? 'unknown'),
    synced: Boolean(v.synced),
    ignored: Boolean(v.is_ignored),
    files_ready: files.length > 0 && !files.some((f) => /fail/i.test(String(f.status ?? ''))),
    details: { sync_product_id: v.sync_product_id, product: v.product ?? null, retail_price: v.retail_price ?? null, currency: v.currency ?? null, files: files.map((f) => ({ type: f.type, status: f.status, preview_url: f.preview_url })) },
  }
}

export async function printfulStores(): Promise<PfStore[]> {
  return printful<PfStore[]>('GET', '/stores')
}

export async function syncProducts(): Promise<PfSyncProductSummary[]> {
  const out: PfSyncProductSummary[] = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await printful<PfSyncProductSummary[]>('GET', `/store/products?offset=${offset}&limit=100`)
    out.push(...page)
    if (page.length < 100) break
  }
  return out
}

export async function syncProduct(id: number) {
  return printful<{ sync_product: PfSyncProductSummary; sync_variants: PfSyncVariant[] }>('GET', `/store/products/${id}`)
}

async function physicalProduct(productId: string, client?: Queryable) {
  const p = await one<{ id: string; title: string; type: string }>('select id, title, type from products where id = $1', [productId], client)
  if (!p) throw notFound('Product')
  if (p.type !== 'physical') throw badRequest('Only physical products are made by Printful.')
  return p
}

/**
 * Links this product's items to exact Printful sync variants of one Printful
 * product, replacing its earlier links. Every pair is checked against
 * Printful's live data; nothing is matched automatically.
 */
export async function linkProduct(actor: SessionUser, productId: string, body: { sync_product_id?: unknown; links?: unknown }, ip?: string) {
  const syncProductId = Number(body.sync_product_id)
  if (!Number.isSafeInteger(syncProductId) || syncProductId <= 0) throw badRequest('Choose the Printful product.')
  const pairs = Array.isArray(body.links) ? (body.links as Array<{ variant_id?: unknown; sync_variant_id?: unknown }>) : []
  const live = await syncProduct(syncProductId)
  const byId = new Map(live.sync_variants.map((v) => [Number(v.id), v]))
  return tx(async (client) => {
    const p = await physicalProduct(productId, client)
    const variants = await q<{ id: string; title: string }>('select id, title from product_variants where product_id = $1 and active', [productId], client)
    const seenItems = new Set<string>()
    const seenSync = new Set<number>()
    const rows = pairs
      .filter((x) => x.sync_variant_id !== '' && x.sync_variant_id !== null && x.sync_variant_id !== undefined)
      .map((x) => {
        const variantId = x.variant_id ? String(x.variant_id) : null
        if (variants.length ? !variants.some((v) => v.id === variantId) : variantId !== null) throw badRequest('One of the store options does not belong to this product.')
        const sv = byId.get(Number(x.sync_variant_id))
        if (!sv) throw badRequest('One of the chosen Printful variants does not belong to that Printful product.')
        const key = variantId ?? 'product'
        if (seenItems.has(key)) throw badRequest('Each store option can be linked to only one Printful variant.')
        if (seenSync.has(sv.id)) throw badRequest('Two store options cannot share one Printful variant.')
        seenItems.add(key)
        seenSync.add(sv.id)
        return { variantId, sv }
      })
    await q('delete from printful_links where product_id = $1', [productId], client)
    for (const r of rows) {
      const f = variantFacts(r.sv)
      try {
        await q(
          `insert into printful_links (product_id, variant_id, sync_product_id, sync_variant_id, catalog_variant_id, name, size, color, sku, availability, synced, ignored, files_ready, details, checked_at, linked_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), $15)`,
          [productId, r.variantId, syncProductId, r.sv.id, f.catalog_variant_id, f.name, f.size, f.color, f.sku, f.availability, f.synced, f.ignored, f.files_ready, JSON.stringify(f.details), actor.email],
          client,
        )
      } catch (err) {
        if (/printful_links_sync_variant_id_key/.test(String((err as Error).message))) throw conflict(`The Printful variant "${r.sv.name}" is already linked to another product.`)
        throw err
      }
    }
    await audit({ actor, action: 'product.printful_linked', entityType: 'product', entityId: productId, summary: `Linked ${rows.length} item${rows.length === 1 ? '' : 's'} of ${p.title} to Printful product ${syncProductId}`, data: { syncProductId, links: rows.map((r) => ({ variantId: r.variantId, syncVariantId: r.sv.id })) }, ip }, client)
    return productLinks(productId, client)
  })
}

/** Creates store options from a Printful product's variants (only for a product with no options yet) and links each one to its own source. */
export async function importVariants(actor: SessionUser, productId: string, syncProductIdInput: unknown, ip?: string) {
  const syncProductId = Number(syncProductIdInput)
  if (!Number.isSafeInteger(syncProductId) || syncProductId <= 0) throw badRequest('Choose the Printful product.')
  const live = await syncProduct(syncProductId)
  const usable = live.sync_variants.filter((v) => !v.is_ignored)
  if (!usable.length) throw badRequest('That Printful product has no variants to import.')
  return tx(async (client) => {
    const p = await physicalProduct(productId, client)
    if (await one('select 1 from product_variants where product_id = $1', [productId], client)) throw badRequest('This product already has options. Link them to Printful variants instead.')
    let i = 0
    for (const v of usable) {
      const f = variantFacts(v)
      const title = [f.color, f.size].filter(Boolean).join(' / ') || f.name
      const options: Record<string, string> = {}
      if (f.size) options.size = f.size
      if (f.color) options.color = f.color
      const nv = await one<{ id: string }>(`insert into product_variants (product_id, title, options, sort_order) values ($1,$2,$3,$4) returning id`, [productId, title, JSON.stringify(options), i++], client)
      await q(
        `insert into printful_links (product_id, variant_id, sync_product_id, sync_variant_id, catalog_variant_id, name, size, color, sku, availability, synced, ignored, files_ready, details, checked_at, linked_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), $15)`,
        [productId, nv!.id, syncProductId, v.id, f.catalog_variant_id, f.name, f.size, f.color, f.sku, f.availability, f.synced, f.ignored, f.files_ready, JSON.stringify(f.details), actor.email],
        client,
      )
    }
    await audit({ actor, action: 'product.printful_imported', entityType: 'product', entityId: productId, summary: `Created ${usable.length} options for ${p.title} from Printful product ${syncProductId}`, ip }, client)
    return productLinks(productId, client)
  })
}

export async function unlinkProduct(actor: SessionUser, productId: string, ip?: string) {
  await physicalProduct(productId)
  await q('delete from printful_links where product_id = $1', [productId])
  await audit({ actor, action: 'product.printful_unlinked', entityType: 'product', entityId: productId, summary: 'Removed the Printful links for this product', ip })
  return productLinks(productId)
}

/** Each sellable item of a product with its Printful link and status, for the admin. */
export async function productLinks(productId: string, client?: Queryable) {
  const variants = await q<{ id: string; title: string }>('select id, title from product_variants where product_id = $1 and active order by sort_order, created_at', [productId], client)
  const links = await q<LinkRow>('select * from printful_links where product_id = $1', [productId], client)
  const items = (variants.length ? variants.map((v) => ({ variant_id: v.id as string | null, title: v.title })) : [{ variant_id: null, title: 'This product (no options)' }]).map((it) => {
    const l = links.find((x) => x.variant_id === it.variant_id)
    return { ...it, link: l ? { ...l, available: linkAvailable(l), problem: linkProblem(l) } : null }
  })
  return { items, syncProductId: links[0]?.sync_product_id ?? null, extraLinks: links.filter((l) => !items.some((i) => i.link?.id === l.id)).length }
}

/** Reads the current Printful state of the given links (all, when no ids are given, oldest first). */
export async function refreshLinks(ids?: string[], limit = 200) {
  const rows = ids?.length
    ? await q<LinkRow>('select * from printful_links where id = any($1)', [ids])
    : await q<LinkRow>('select * from printful_links order by checked_at nulls first limit $1', [limit])
  let checked = 0
  for (const l of rows) {
    try {
      const r = await printful<{ sync_variant: PfSyncVariant }>('GET', `/store/variants/${l.sync_variant_id}`)
      const f = variantFacts(r.sync_variant)
      await q(
        `update printful_links set catalog_variant_id = $2, name = $3, size = $4, color = $5, sku = $6, availability = $7, synced = $8, ignored = $9, files_ready = $10, details = $11, checked_at = now(), check_error = '' where id = $1`,
        [l.id, f.catalog_variant_id, f.name, f.size, f.color, f.sku, f.availability, f.synced, f.ignored, f.files_ready, JSON.stringify(f.details)],
      )
      checked++
    } catch (err) {
      if (err instanceof PrintfulError && err.status === 404) {
        await q(`update printful_links set availability = 'missing', check_error = 'This variant no longer exists in Printful.', checked_at = now() where id = $1`, [l.id])
      } else if (err instanceof PrintfulError) {
        await q(`update printful_links set check_error = $2, checked_at = now() where id = $1`, [l.id, `Printful: ${err.message}`.slice(0, 300)])
      } else throw err // uncertain: keep the last known state and try again later
    }
  }
  return checked
}

/** The links for physical cart lines, refreshed from Printful when not checked recently. Throws a clear message for anything that cannot be made. */
export async function linksForLines(lines: Array<{ product_id: string; variant_id: string | null; title: string; variant_title: string; quantity: number }>, opts: { refresh?: boolean } = {}) {
  const found = await q<LinkRow>(
    `select * from printful_links where (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) in (select * from unnest($1::uuid[], $2::uuid[]))`,
    [lines.map((l) => l.product_id), lines.map((l) => l.variant_id ?? '00000000-0000-0000-0000-000000000000')],
  )
  const label = (l: { title: string; variant_title: string }) => `${l.title}${l.variant_title ? ` (${l.variant_title})` : ''}`
  const match = (l: { product_id: string; variant_id: string | null }) => found.find((x) => x.product_id === l.product_id && (x.variant_id ?? null) === (l.variant_id ?? null))
  for (const l of lines) if (!match(l)) throw conflict(`${label(l)} is not available to order right now.`, 'printful_unmapped')
  if (opts.refresh) {
    const stale = found.filter((x) => !x.checked_at || Date.now() - new Date(x.checked_at).getTime() > FRESH_MS)
    if (stale.length) {
      try {
        await refreshLinks(stale.map((x) => x.id))
      } catch (err) {
        if (err instanceof PrintfulUncertain) throw new HttpError(503, 'We could not reach our print partner to check availability. Please try again in a moment.', 'printful_unreachable')
        throw err
      }
      const fresh = await q<LinkRow>('select * from printful_links where id = any($1)', [found.map((x) => x.id)])
      found.splice(0, found.length, ...fresh)
    }
  }
  return lines.map((l) => {
    const link = match(l)!
    if (!linkAvailable(link)) throw conflict(`${label(l)} is not available to order right now.`, 'printful_unavailable')
    return { ...l, link }
  })
}

/* ---------- Shipping address and quotes ---------- */

export interface ShipAddress {
  name: string
  address1: string
  address2: string
  city: string
  state_code: string
  country_code: string
  zip: string
  phone: string
}

const NEEDS_STATE = new Set(['US', 'CA', 'AU'])

export function parseAddress(v: unknown, countries: string[]): ShipAddress {
  const b = (v ?? {}) as Record<string, unknown>
  const f = (k: string, max: number) => String(b[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const a: ShipAddress = {
    name: f('name', 100),
    address1: f('address1', 200),
    address2: f('address2', 200),
    city: f('city', 100),
    state_code: f('state_code', 10).toUpperCase(),
    country_code: f('country_code', 2).toUpperCase(),
    zip: f('zip', 20).toUpperCase(),
    phone: f('phone', 30),
  }
  if (!a.name) throw badRequest('Please enter the name for the delivery.')
  if (!a.address1) throw badRequest('Please enter the street address.')
  if (!a.city) throw badRequest('Please enter the city.')
  if (!/^[A-Z]{2}$/.test(a.country_code)) throw badRequest('Please choose the country.')
  if (!countries.includes(a.country_code)) throw badRequest('Sorry, we do not ship to that country yet.')
  if (NEEDS_STATE.has(a.country_code) && !/^[A-Z0-9]{1,3}$/.test(a.state_code)) throw badRequest('Please choose the state or province.')
  if (!a.zip) throw badRequest('Please enter the ZIP or postal code.')
  if (a.country_code === 'US' && !/^\d{5}(-\d{4})?$/.test(a.zip)) throw badRequest('Please enter a valid ZIP code.')
  return a
}

export interface QuoteOption {
  id: string
  name: string
  rate_cents: number
  min_days: number | null
  max_days: number | null
}

export interface QuoteItem {
  product_id: string
  variant_id: string | null
  quantity: number
  sync_variant_id: number
  catalog_variant_id: number | null
}

const recipientFor = (a: ShipAddress) => ({ address1: a.address1, address2: a.address2 || undefined, city: a.city, state_code: a.state_code || undefined, country_code: a.country_code, zip: a.zip })

/** Real Printful shipping options for these physical lines and address. Stored briefly so checkout charges exactly what was shown. */
export async function quoteShipping(userId: string, physical: Array<{ product_id: string; variant_id: string | null; title: string; variant_title: string; quantity: number }>, addressInput: unknown) {
  const sales = await physicalSales()
  if (!sales.open) throw new HttpError(409, sales.reason, 'physical_sales_closed')
  if (!physical.length) throw badRequest('Nothing in your bag needs shipping.')
  const settings = await getSettings()
  const address = parseAddress(addressInput, settings.shipping.countries)
  const linked = await linksForLines(physical, { refresh: true })
  const items: QuoteItem[] = linked.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, sync_variant_id: Number(l.link.sync_variant_id), catalog_variant_id: l.link.catalog_variant_id ? Number(l.link.catalog_variant_id) : null }))
  if (items.some((i) => !i.catalog_variant_id)) throw conflict('One of the items cannot be quoted for shipping yet. Please contact us.', 'printful_unmapped')
  let rates: PfShippingRate[]
  try {
    rates = await printful<PfShippingRate[]>('POST', '/shipping/rates', {
      recipient: recipientFor(address),
      items: items.map((i) => ({ variant_id: i.catalog_variant_id, quantity: i.quantity })),
      currency: 'USD',
      locale: 'en_US',
    })
  } catch (err) {
    if (err instanceof PrintfulError) throw new HttpError(422, `We could not get shipping for this address: ${err.message} Please check the address.`, 'shipping_unavailable')
    if (err instanceof PrintfulUncertain) throw new HttpError(503, 'We could not get shipping prices right now. Please try again in a moment.', 'printful_unreachable')
    throw err
  }
  const options: QuoteOption[] = (Array.isArray(rates) ? rates : [])
    .filter((r) => String(r.currency).toUpperCase() === 'USD' && Number.isFinite(Number(r.rate)) && Number(r.rate) >= 0 && r.id)
    .map((r) => ({
      id: String(r.id).slice(0, 60),
      name: String(r.name ?? r.id).slice(0, 100),
      rate_cents: Math.round(Number(r.rate) * 100),
      min_days: Number(r.minDeliveryDays ?? r.min_delivery_days) || null,
      max_days: Number(r.maxDeliveryDays ?? r.max_delivery_days) || null,
    }))
  if (!options.length) throw new HttpError(422, 'Shipping is not available to this address for these items. Please check the address or contact us.', 'shipping_unavailable')
  const row = await one<{ id: string; expires_at: string }>(
    `insert into shipping_quotes (user_id, address, items, options, expires_at) values ($1,$2,$3,$4, now() + make_interval(mins => $5)) returning id, expires_at`,
    [userId, JSON.stringify(address), JSON.stringify(items), JSON.stringify(options), QUOTE_MINUTES],
  )
  return { quoteId: row!.id, expiresAt: row!.expires_at, address, options }
}

/** Checks a quote at checkout: the customer's, still valid, for exactly these items. Returns the address and chosen option. */
export async function useQuote(userId: string, physical: Array<{ product_id: string; variant_id: string | null; quantity: number }>, choice: { quote_id?: unknown; option_id?: unknown } | undefined) {
  if (!choice?.quote_id || !choice.option_id) throw new HttpError(400, 'Please enter your shipping address and choose a shipping option first.', 'shipping_required')
  const id = String(choice.quote_id)
  const quote = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? await one<{ id: string; address: ShipAddress; items: QuoteItem[]; options: QuoteOption[]; expired: boolean }>(
        `select id, address, items, options, expires_at < now() as expired from shipping_quotes where id = $1 and user_id = $2`,
        [id, userId],
      )
    : null
  if (!quote) throw new HttpError(400, 'Please get shipping options for your address again.', 'shipping_quote_missing')
  if (quote.expired) throw new HttpError(409, 'Shipping prices are only held for a short time. Please get shipping options again.', 'shipping_quote_expired')
  const key = (i: { product_id: string; variant_id: string | null; quantity: number }) => `${i.product_id}:${i.variant_id ?? ''}:${i.quantity}`
  const want = physical.map(key).sort().join('|')
  const have = quote.items.map(key).sort().join('|')
  if (want !== have) throw new HttpError(409, 'Your bag changed after shipping was quoted. Please get shipping options again.', 'shipping_quote_changed')
  const option = quote.options.find((o) => o.id === String(choice.option_id))
  if (!option) throw badRequest('Please choose one of the shipping options shown.')
  return { quoteId: quote.id, address: quote.address, option, items: quote.items }
}

/* ---------- Fulfillment jobs ---------- */

type JobState = 'queued' | 'submitting' | 'uncertain' | 'draft' | 'confirming' | 'submitted' | 'needs_attention' | 'canceled' | 'fulfilled'
interface JobRow {
  order_id: string
  external_id: string
  state: JobState
  printful_order_id: string | null
  printful_status: string
  auto_confirm: boolean
  test_mode: boolean
  attempts: number
  last_error: string
  attention_reason: string
}

let livePaymentsForTests: boolean | null = null
/** Tests only: treat payments as live (real money) so automatic confirmation can be tested against the fake Printful. */
export function setLivePaymentsForTests(v: boolean | null) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Only for tests.')
  livePaymentsForTests = v
}

/** Called inside the payment transaction: one job per order with physical items. Repeated payment events add nothing. */
export async function queuePrintfulOrder(orderId: string, client: PoolClient) {
  const physical = await one('select 1 from order_items where order_id = $1 and product_type = $2', [orderId, 'physical'], client)
  if (!physical) return false
  const s = await getSettings(client)
  const demo = Boolean((await one<{ is_demo: boolean }>('select is_demo from orders where id = $1', [orderId], client))?.is_demo)
  // A Stripe test payment does not make a Printful order free: test and demo orders are only ever drafts, which Printful does not charge.
  const testMode = demo || !(livePaymentsForTests ?? paymentsState() === 'live')
  const r = await q(
    `insert into printful_orders (order_id, external_id, auto_confirm, test_mode) values ($1,$2,$3,$4) on conflict (order_id) do nothing returning order_id`,
    [orderId, orderId.replace(/-/g, ''), s.printful.auto_confirm && !testMode, testMode],
    client,
  )
  if (r.length) await q(`insert into order_updates (order_id, message, created_by) values ($1,'Sent to our print partner to be made.','system')`, [orderId], client)
  return r.length > 0
}

const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.min(attempts, 6))

/** Moves an order onto Printful's state, as read from Printful. */
async function adopt(job: JobRow, pf: PfOrder, client?: Queryable): Promise<JobState> {
  const status = String(pf.status ?? '')
  let state: JobState
  let reason = ''
  if (status === 'draft') {
    if (job.auto_confirm) state = 'confirming'
    else {
      state = 'draft'
      reason = job.test_mode
        ? 'Paid with a Stripe test card (or a demo order), so it was only created as a Printful draft, which Printful does not charge. Confirming it would make and charge a real order.'
        : 'Created in Printful as a draft. Automatic confirmation is off, so confirm it for production in the order (Printful charges your billing method when you do).'
    }
  } else if (status === 'failed') {
    state = 'needs_attention'
    reason = 'Printful could not process this order (often a billing problem, such as a declined card). Fix it in Printful, then use "Confirm for production" here.'
  } else if (status === 'onhold') {
    state = 'needs_attention'
    reason = 'Printful put this order on hold. Check the order in your Printful dashboard.'
  } else if (status === 'canceled') {
    state = 'canceled'
    reason = 'This order was canceled in Printful. A customer refund, if any, is separate and must be done from the order here.'
  } else if (status === 'fulfilled' || status === 'archived') state = 'fulfilled'
  else state = 'submitted' // pending, inprocess, partial
  const confirmed = !['draft', 'failed', 'canceled'].includes(status)
  await q(
    `update printful_orders set printful_order_id = $2, printful_status = $3, state = $4, attention_reason = $5, costs = coalesce($6, costs),
       submitted_at = coalesce(submitted_at, now()), confirmed_at = case when $7 then coalesce(confirmed_at, now()) else confirmed_at end,
       last_error = case when $4 in ('needs_attention','draft') then last_error else '' end,
       attention_notified_at = case when attention_reason is distinct from $5 then null else attention_notified_at end,
       -- A job about to confirm keeps its claim so no other worker confirms it too.
       last_synced_at = now(), claimed_at = case when $4 = 'confirming' then now() else null end, next_attempt_at = now(), updated_at = now()
     where order_id = $1`,
    [job.order_id, pf.id, status, state, reason, pf.costs ? JSON.stringify(pf.costs) : null, confirmed],
    client,
  )
  return state
}

async function needsAttention(job: JobRow, reason: string, error = '') {
  await q(
    `update printful_orders set state = 'needs_attention', attention_reason = $2, last_error = $3, claimed_at = null, updated_at = now(),
       attention_notified_at = case when attention_reason is distinct from $2 then null else attention_notified_at end
     where order_id = $1`,
    [job.order_id, reason, error.slice(0, 500)],
  )
}

async function orderBody(job: JobRow) {
  const o = await one<{ id: string; email: string; shipping_address: { name?: string; phone?: string; address?: Record<string, string | null> } | null; shipping_method: { option: QuoteOption; items: QuoteItem[] } | null; subtotal_cents: number; discount_cents: number; shipping_cents: number; tax_cents: number }>(
    'select * from orders where id = $1',
    [job.order_id],
  )
  if (!o?.shipping_address || !o.shipping_method?.option) throw new PrintfulError('This order has no quoted shipping address or method, so it cannot be sent to Printful.', 0)
  const items = await q<{ id: string; product_id: string; variant_id: string | null; quantity: number; refunded_quantity: number; unit_price_cents: number }>(
    `select * from order_items where order_id = $1 and product_type = 'physical' order by id`,
    [job.order_id],
  )
  const lines = items
    .map((it) => {
      const qi = o.shipping_method!.items.find((x) => x.product_id === it.product_id && (x.variant_id ?? null) === (it.variant_id ?? null))
      if (!qi) throw new PrintfulError('An item on this order has no Printful variant recorded from checkout.', 0)
      return { sync_variant_id: qi.sync_variant_id, quantity: it.quantity - it.refunded_quantity, external_id: it.id, retail_price: money(it.unit_price_cents) }
    })
    .filter((l) => l.quantity > 0)
  const ad = o.shipping_address.address ?? {}
  const a: ShipAddress = {
    name: String(o.shipping_address.name ?? ''),
    address1: String(ad.line1 ?? ''),
    address2: String(ad.line2 ?? ''),
    city: String(ad.city ?? ''),
    state_code: String(ad.state ?? ''),
    country_code: String(ad.country ?? ''),
    zip: String(ad.postal_code ?? ''),
    phone: String(o.shipping_address.phone ?? ''),
  }
  return {
    lines,
    body: {
      external_id: job.external_id,
      shipping: o.shipping_method.option.id,
      recipient: { name: a.name, address1: a.address1, address2: a.address2 || undefined, city: a.city, state_code: a.state_code || undefined, country_code: a.country_code, zip: a.zip, phone: a.phone || undefined, email: o.email },
      items: lines,
      retail_costs: { currency: 'USD', subtotal: money(o.subtotal_cents), discount: money(o.discount_cents), shipping: money(o.shipping_cents), tax: money(o.tax_cents) },
    },
  }
}

/** Looks the order up in Printful by our external id. Null when Printful has no such order. */
async function findByExternalId(externalId: string): Promise<PfOrder | null> {
  try {
    return await printful<PfOrder>('GET', `/orders/@${externalId}`)
  } catch (err) {
    if (err instanceof PrintfulError && err.status === 404) return null
    throw err
  }
}

/** One step of work for a claimed job. Every outcome is written to the job; nothing is assumed. */
async function work(job: JobRow) {
  try {
    if (job.state === 'queued' || job.state === 'uncertain' || job.state === 'submitting') {
      // Reconcile first: a request that timed out may still have created the order.
      const existing = job.printful_order_id ? await printful<PfOrder>('GET', `/orders/${job.printful_order_id}`) : await findByExternalId(job.external_id)
      if (existing) {
        const next = await adopt(job, existing)
        if (next === 'confirming') return work({ ...job, state: 'confirming', printful_order_id: String(existing.id) })
        return
      }
      const { lines, body } = await orderBody(job)
      if (!lines.length) {
        await q(`update printful_orders set state = 'canceled', attention_reason = 'Every physical item was refunded before it was sent, so nothing was sent to Printful.', claimed_at = null, updated_at = now() where order_id = $1`, [job.order_id])
        return
      }
      await q(`update printful_orders set attempts = attempts + 1, updated_at = now() where order_id = $1`, [job.order_id])
      const created = await printful<PfOrder>('POST', `/orders?confirm=${job.auto_confirm ? 'true' : 'false'}`, body)
      const next = await adopt(job, created)
      // Printful may still answer "draft" right after a confirm request while it calculates costs: confirm explicitly.
      if (next === 'confirming') return work({ ...job, state: 'confirming', printful_order_id: String(created.id) })
      return
    }
    if (job.state === 'confirming' && job.printful_order_id) {
      const current = await printful<PfOrder>('GET', `/orders/${job.printful_order_id}`)
      if (current.status !== 'draft' && current.status !== 'failed') {
        await adopt(job, current)
        return
      }
      await q(`update printful_orders set attempts = attempts + 1, updated_at = now() where order_id = $1`, [job.order_id])
      const confirmed = await printful<PfOrder>('POST', `/orders/${job.printful_order_id}/confirm`)
      const next = await adopt({ ...job, auto_confirm: false }, confirmed)
      if (next === 'draft') await needsAttention(job, 'Printful did not confirm this order for production. Check billing in Printful, then use "Confirm for production" here.')
    }
  } catch (err) {
    if (err instanceof PrintfulUncertain) {
      const attempts = job.attempts + 1
      const state: JobState = job.state === 'confirming' ? 'confirming' : 'uncertain'
      await q(
        `update printful_orders set state = $2, attempts = $3, last_error = $4, claimed_at = null, next_attempt_at = now() + make_interval(mins => $5), updated_at = now() where order_id = $1`,
        [job.order_id, state, attempts, err.message.slice(0, 500), backoffMinutes(attempts)],
      )
      if (attempts >= MAX_UNCERTAIN_ATTEMPTS) {
        await q(`update printful_orders set attention_reason = $2, state = 'needs_attention' where order_id = $1`, [
          job.order_id,
          'Printful has not answered clearly after several tries. Use "Check with Printful" before doing anything else: the order may already exist there.',
        ])
      }
      return
    }
    if (err instanceof PrintfulError && job.state === 'confirming' && job.printful_order_id) {
      // The confirm may have been refused because it already went through: believe Printful's order, not the error.
      try {
        const now = await printful<PfOrder>('GET', `/orders/${job.printful_order_id}`)
        if (now.status !== 'draft' && now.status !== 'failed') {
          await adopt(job, now)
          return
        }
      } catch {
        /* fall through to flag it */
      }
    }
    if (err instanceof PrintfulError) {
      const charge = /charge|billing|payment|card|wallet|balance/i.test(err.message)
      await needsAttention(
        job,
        job.state === 'confirming' || charge
          ? `Printful did not confirm the order for production: ${err.message} Fix this in Printful (often billing), then use "Confirm for production".`
          : `Printful refused the order: ${err.message}`,
        err.message,
      )
      return
    }
    throw err
  }
}

/** Claims due jobs (one worker per job, even across serverless instances) and runs them. */
export async function runPrintfulQueue(limit = 10) {
  if (!printfulConfigured()) return 0
  let done = 0
  for (; done < limit; done++) {
    const job = await one<JobRow>(
      `update printful_orders set claimed_at = now(), updated_at = now()
        where order_id = (select order_id from printful_orders
                           where state in ('queued','uncertain','confirming','submitting') and next_attempt_at <= now()
                             and (claimed_at is null or claimed_at < now() - make_interval(secs => $1))
                           order by next_attempt_at limit 1 for update skip locked)
        returning *`,
      [LEASE_MS / 1000],
    )
    if (!job) break
    await work(job)
  }
  await notifyAttention()
  return done
}

let running: Promise<void> | null = null
let again = false
/** Starts the queue right after a payment, kept alive on Vercel until it finishes. */
export function kickPrintful() {
  if (!printfulConfigured()) return
  if (running) {
    again = true
    return
  }
  running = (async () => {
    await new Promise((r) => setImmediate(r))
    try {
      do {
        again = false
        await runPrintfulQueue()
      } while (again)
    } catch (err) {
      console.error('[printful] queue error', err)
    } finally {
      running = null
    }
  })()
  waitUntil(running)
}

/** Tests: waits for a started queue run. */
export async function printfulIdle() {
  while (running) await running
}

/* ---------- Reading orders back: status, shipments, tracking ---------- */

async function recomputeFulfillment(orderId: string, client: Queryable) {
  const rows = await q<{ quantity: number; refunded_quantity: number; shipped: number }>(
    `select oi.quantity, oi.refunded_quantity, coalesce((select sum(si.quantity) from shipment_items si where si.order_item_id = oi.id), 0)::int as shipped
       from order_items oi where oi.order_id = $1 and oi.product_type = 'physical'`,
    [orderId],
    client,
  )
  const due = rows.filter((r) => r.quantity - r.refunded_quantity > 0)
  const anyShipped = rows.some((r) => r.shipped > 0)
  const allShipped = due.length > 0 && due.every((r) => r.shipped >= r.quantity - r.refunded_quantity)
  const status = allShipped ? 'fulfilled' : anyShipped ? 'partially_fulfilled' : 'unfulfilled'
  await q(`update orders set fulfillment_status = $2, updated_at = now() where id = $1 and fulfillment_status <> 'not_required'`, [orderId, status], client)
}

async function applyShipment(orderId: string, pf: PfOrder, s: PfShipment) {
  const tracking = String(s.tracking_number ?? '').slice(0, 100)
  const url = /^https:\/\//.test(String(s.tracking_url ?? '')) ? String(s.tracking_url).slice(0, 500) : ''
  const carrier = [s.carrier, s.service].filter(Boolean).join(' ').slice(0, 100)
  const shippedAt = s.shipped_at ? new Date(Number(s.shipped_at) * 1000) : s.ship_date ? new Date(s.ship_date) : new Date()
  const created = await tx(async (client) => {
    const existing = await one<{ id: string; tracking_number: string }>('select id, tracking_number from shipments where printful_shipment_id = $1 for update', [s.id], client)
    if (existing) {
      if (tracking && tracking !== existing.tracking_number) await q('update shipments set tracking_number = $2, tracking_url = $3, carrier = $4, updated_at = now() where id = $1', [existing.id, tracking, url, carrier], client)
      return { id: existing.id, isNew: false }
    }
    const sh = await one<{ id: string }>(
      `insert into shipments (order_id, carrier, tracking_number, tracking_url, status, shipped_at, status_at, created_by, printful_shipment_id) values ($1,$2,$3,$4,'shipped',$5,$5,'printful',$6) returning id`,
      [orderId, carrier, tracking, url, shippedAt.toISOString(), s.id],
      client,
    )
    // Printful's item ids map back to our order lines through the external id we sent.
    for (const it of s.items ?? []) {
      const pfItem = (pf.items ?? []).find((x) => Number(x.id) === Number(it.item_id))
      const ourId = pfItem?.external_id
      if (ourId && (await one('select 1 from order_items where id = $1 and order_id = $2', [ourId, orderId], client))) {
        await q('insert into shipment_items (shipment_id, order_item_id, quantity) values ($1,$2,$3) on conflict do nothing', [sh!.id, ourId, Math.max(1, Number(it.quantity) || 1)], client)
      }
    }
    await q(`insert into order_updates (order_id, message, created_by) values ($1,$2,'printful')`, [orderId, `${s.reshipment ? 'A replacement shipped' : 'Shipped'}${carrier ? ` with ${carrier}` : ''}${tracking ? `. Tracking number ${tracking}` : ''}.`], client)
    await recomputeFulfillment(orderId, client)
    const o = (await one<{ email: string; customer_name: string; order_number: string; user_id: string | null; is_demo: boolean }>('select * from orders where id = $1', [orderId], client))!
    // One shipping email per Printful shipment, however often Printful tells us about it.
    await queueEmail(
      {
        type: 'shipping_confirmation',
        to: o.email,
        userId: o.user_id,
        orderId,
        isDemo: o.is_demo,
        vars: { name: o.customer_name, order_number: o.order_number, carrier: carrier || 'our carrier', tracking_number: tracking || 'not provided yet' },
        idempotencyKey: `printful_shipment:${s.id}`,
      },
      client,
    )
    return { id: sh!.id, isNew: true }
  })
  // Delivery only when Printful itself reports a delivery time.
  if (s.delivered_at) {
    const at = typeof s.delivered_at === 'number' ? new Date(s.delivered_at * 1000) : new Date(s.delivered_at)
    if (!Number.isNaN(at.getTime())) await ingestDeliveryEvent({ source: 'printful', eventId: `shipment:${s.id}:delivered`, shipmentId: created.id, status: 'delivered', occurredAt: at.toISOString(), payload: { printful_shipment_id: s.id } })
  }
  return created.isNew
}

/** Reads the order from Printful and applies its status and shipments. */
export async function syncPrintfulOrder(orderId: string) {
  const job = await one<JobRow>('select * from printful_orders where order_id = $1', [orderId])
  if (!job) throw notFound('Printful order')
  const pf = job.printful_order_id ? await printful<PfOrder>('GET', `/orders/${job.printful_order_id}`) : await findByExternalId(job.external_id)
  if (!pf) {
    await q('update printful_orders set last_synced_at = now() where order_id = $1', [orderId])
    return { found: false, shipments: 0 }
  }
  if (!['queued', 'submitting', 'uncertain', 'confirming'].includes(job.state) || job.printful_order_id) await adopt(job, pf)
  let added = 0
  for (const s of pf.shipments ?? []) if (await applyShipment(orderId, pf, s)) added++
  if (added) kickDispatcher()
  return { found: true, status: pf.status, shipments: added }
}

/** Hourly: refresh links, run due jobs, and re-read orders still in progress (in case a webhook was missed). */
export async function runPrintfulMaintenance() {
  if (!printfulConfigured()) return { configured: false }
  const out = { configured: true, links: 0, jobs: 0, synced: 0, errors: 0 }
  try {
    out.links = await refreshLinks(undefined, 50)
  } catch {
    out.errors++
  }
  out.jobs = await runPrintfulQueue(25)
  const active = await q<{ order_id: string }>(
    `select order_id from printful_orders where state in ('submitted','draft','needs_attention') and printful_order_id is not null
      and (last_synced_at is null or last_synced_at < now() - interval '50 minutes') order by last_synced_at nulls first limit 25`,
  )
  for (const a of active) {
    try {
      await syncPrintfulOrder(a.order_id)
      out.synced++
    } catch {
      out.errors++
    }
  }
  await notifyAttention()
  return out
}

/* ---------- Admin alerts ---------- */

/** Emails the admins once for each new reason an order needs attention, and notes it on the order. */
export async function notifyAttention() {
  const rows = await q<{ order_id: string; attention_reason: string; state: string; order_number: string }>(
    `select p.order_id, p.attention_reason, p.state, o.order_number from printful_orders p join orders o on o.id = p.order_id
      where p.state in ('needs_attention','draft','canceled') and p.attention_reason <> '' and p.attention_notified_at is null`,
  )
  if (!rows.length) return 0
  const admins = await q<{ email: string; name: string }>(`select email, name from "user" where role = 'admin'`)
  for (const r of rows) {
    const key = createHash('sha256').update(r.attention_reason).digest('hex').slice(0, 16)
    await tx(async (client) => {
      await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,'system')`, [r.order_id, `Printful: ${r.attention_reason}`], client)
      for (const a of admins) {
        await queueEmail(
          { type: 'fulfillment_alert', to: a.email, orderId: r.order_id, vars: { name: a.name, order_number: r.order_number, reason: r.attention_reason }, idempotencyKey: `fulfillment_alert:${r.order_id}:${key}:${a.email}` },
          client,
        )
      }
      await q('update printful_orders set attention_notified_at = now() where order_id = $1', [r.order_id], client)
    })
  }
  kickDispatcher()
  return rows.length
}

/* ---------- Admin actions ---------- */

async function lockJob(orderId: string, client: PoolClient) {
  const job = await one<JobRow & { claimed_at: string | null }>('select * from printful_orders where order_id = $1 for update', [orderId], client)
  if (!job) throw notFound('Printful order')
  if (job.claimed_at && Date.now() - new Date(job.claimed_at).getTime() < LEASE_MS) throw conflict('This order is being sent to Printful right now. Try again in a minute.')
  return job
}

/**
 * "Check with Printful and continue": reconciles by external id first, then
 * submits only if Printful has no such order. Safe to press repeatedly.
 */
export async function retryPrintfulOrder(actor: SessionUser, orderId: string, ip?: string) {
  await tx(async (client) => {
    const job = await lockJob(orderId, client)
    if (['submitted', 'fulfilled', 'canceled'].includes(job.state)) throw badRequest('Nothing to retry: Printful already has this order. Use "Check with Printful" to refresh it.')
    await q(`update printful_orders set state = case when printful_order_id is null then 'uncertain' else state end, next_attempt_at = now(), attention_notified_at = null, updated_at = now() where order_id = $1`, [orderId], client)
    await audit({ actor, action: 'printful.retry', entityType: 'order', entityId: orderId, summary: 'Asked to check with Printful and continue sending the order', ip }, client)
  })
  const job = await one<JobRow>(`update printful_orders set claimed_at = now() where order_id = $1 and state in ('queued','uncertain','confirming','submitting') returning *`, [orderId])
  if (job) await work(job)
  else await syncPrintfulOrder(orderId)
  await notifyAttention()
  return printfulOrderDetail(orderId)
}

/** Explicit owner confirmation for production (Printful charges the owner's billing method). */
export async function confirmPrintfulOrder(actor: SessionUser, orderId: string, ip?: string) {
  const job = await tx(async (client) => {
    const j = await lockJob(orderId, client)
    if (!j.printful_order_id) throw badRequest('This order is not in Printful yet. Use "Check with Printful and continue" first.')
    await q(`update printful_orders set state = 'confirming', claimed_at = now(), attention_notified_at = null, updated_at = now() where order_id = $1`, [orderId], client)
    await audit({ actor, action: 'printful.confirm', entityType: 'order', entityId: orderId, summary: `Confirmed Printful order ${j.printful_order_id} for production`, ip }, client)
    return j
  })
  await work({ ...job, state: 'confirming' })
  await notifyAttention()
  return printfulOrderDetail(orderId)
}

/**
 * Asks Printful to cancel. Printful allows this only before production
 * (draft or pending). This never refunds the customer: that is a separate
 * action on the order.
 */
export async function cancelPrintfulOrder(actor: SessionUser, orderId: string, reasonInput: unknown, ip?: string) {
  const reason = String(reasonInput ?? '').trim().slice(0, 300)
  if (reason.length < 3) throw badRequest('Please give a reason for canceling.')
  const job = await tx(async (client) => {
    const j = await lockJob(orderId, client)
    if (!j.printful_order_id) {
      await q(`update printful_orders set state = 'canceled', attention_reason = $2, updated_at = now() where order_id = $1`, [orderId, `Not sent to Printful (stopped by ${actor.email}): ${reason}`], client)
      await audit({ actor, action: 'printful.stopped', entityType: 'order', entityId: orderId, summary: `Stopped sending the order to Printful: ${reason}`, ip }, client)
      return null
    }
    return j
  })
  if (job) {
    const current = await printful<PfOrder>('GET', `/orders/${job.printful_order_id}`)
    if (!['draft', 'pending', 'failed'].includes(current.status)) {
      await adopt(job, current)
      throw badRequest(`Printful shows this order as "${current.status}", so it can no longer be canceled through the API. Contact Printful support if it must be stopped.`)
    }
    const canceled = await printful<PfOrder>('DELETE', `/orders/${job.printful_order_id}`)
    await adopt(job, canceled)
    // The owner did this themselves: no alert email about it.
    await q('update printful_orders set attention_notified_at = now() where order_id = $1', [orderId])
    await audit({ actor, action: 'printful.cancel', entityType: 'order', entityId: orderId, summary: `Canceled Printful order ${job.printful_order_id}: ${reason}. The customer refund is separate.`, ip })
  }
  await q(`insert into order_notes (order_id, body, author_email) values ($1,$2,$3)`, [orderId, `Printful order canceled: ${reason}. This does not refund the customer.`, actor.email])
  return printfulOrderDetail(orderId)
}

export async function printfulOrderDetail(orderId: string) {
  return one<Record<string, unknown>>(
    `select order_id, external_id, state, printful_order_id::text, printful_status, auto_confirm, test_mode, attempts, last_error, attention_reason, costs, submitted_at, confirmed_at, last_synced_at, created_at, updated_at
       from printful_orders where order_id = $1`,
    [orderId],
  )
}

/* ---------- Webhooks ---------- */

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Checks that a webhook came from Printful: by the HMAC-SHA256 signature
 * (x-pf-webhook-signature, keyed with the hex decoded secret) when a signing
 * secret is configured, otherwise by the secret token in the registered
 * webhook address. Either way, the event only prompts a fresh API read.
 */
export function verifyPrintfulWebhook(raw: string, urlToken: string | undefined, signature: string | undefined) {
  const { webhookSecret, webhookToken } = config.printful
  if (webhookSecret) {
    if (!signature) return false
    const expected = createHmac('sha256', Buffer.from(webhookSecret, 'hex')).update(raw).digest('hex')
    return safeEqual(expected, signature.trim().toLowerCase())
  }
  if (webhookToken) return Boolean(urlToken) && safeEqual(webhookToken, String(urlToken))
  return false
}

export async function ingestPrintfulWebhook(raw: string) {
  const digest = createHash('sha256').update(raw).digest('hex')
  let payload: { type?: string; data?: { order?: { id?: number; external_id?: string } } } = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    throw badRequest('Not JSON.')
  }
  const pfId = Number(payload.data?.order?.id) || null
  const stored = await one<{ id: string }>(
    `insert into printful_events (digest, type, printful_order_id, payload) values ($1,$2,$3,$4) on conflict (digest) do nothing returning id`,
    [digest, String(payload.type ?? '').slice(0, 60), pfId, raw.length < 200_000 ? raw : '{}'],
  )
  if (!stored) return 'duplicate'
  const ext = String(payload.data?.order?.external_id ?? '')
  const job = await one<{ order_id: string }>('select order_id from printful_orders where printful_order_id = $1 or (external_id = $2 and $2 <> \'\')', [pfId, ext])
  const outcome = async (o: string) => {
    await q('update printful_events set outcome = $2 where id = $1', [stored.id, o])
    return o
  }
  if (!job) return outcome('No matching order.')
  try {
    const r = await syncPrintfulOrder(job.order_id)
    await notifyAttention()
    return outcome(r.found ? `Synced: ${r.status}, ${r.shipments} new shipment(s).` : 'Printful has no such order.')
  } catch (err) {
    if (err instanceof PrintfulUncertain) {
      await q('update printful_orders set last_synced_at = null where order_id = $1', [job.order_id])
      return outcome('Printful did not answer; the hourly check will read it.')
    }
    throw err
  }
}

const WEBHOOK_TYPES = ['package_shipped', 'package_returned', 'order_failed', 'order_canceled', 'order_put_hold', 'order_remove_hold', 'order_updated']
export const webhookUrl = () => `${config.appUrl}/api/webhooks/printful/${config.printful.webhookToken}`
const maskUrl = (u: string) => u.replace(/(\/api\/webhooks\/printful\/)[^/?#]+/, '$1••••')

export async function webhookStatus() {
  const current = await printful<{ url?: string; types?: string[] } | null>('GET', '/webhooks')
  const url = current?.url ?? ''
  return { url: url ? maskUrl(url) : '', types: current?.types ?? [], ours: Boolean(config.printful.webhookToken) && url === webhookUrl() }
}

/** Points the Printful store's webhook at this site. Replaces any earlier webhook address, so the admin confirms first. */
export async function registerWebhook(actor: SessionUser, ip?: string) {
  if (!config.printful.webhookToken) throw badRequest('Set PRINTFUL_WEBHOOK_TOKEN in Vercel first.')
  const before = await webhookStatus()
  await printful('POST', '/webhooks', { url: webhookUrl(), types: WEBHOOK_TYPES })
  await audit({ actor, action: 'printful.webhook_registered', entityType: 'settings', entityId: 'printful', summary: `Pointed Printful webhooks at this site${before.url && !before.ours ? ` (replacing ${before.url})` : ''}`, ip })
  return webhookStatus()
}

/* ---------- Overview and safe checks for the admin ---------- */

export async function printfulOverview() {
  const settings = (await getSettings()).printful
  const base = {
    configured: printfulConfigured(),
    storeIdSet: Boolean(config.printful.storeId),
    webhookToken: Boolean(config.printful.webhookToken),
    webhookSecret: Boolean(config.printful.webhookSecret),
    settings,
    sales: await physicalSales(),
  }
  const products = await q<{ id: string; title: string; status: string; active: boolean; variants: number; links: number; available: number }>(
    `select p.id, p.title, p.status, p.active,
            (select count(*) from product_variants v where v.product_id = p.id and v.active)::int as variants,
            (select count(*) from printful_links l where l.product_id = p.id)::int as links,
            (select count(*) from printful_links l where l.product_id = p.id and l.availability = 'active' and l.synced and not l.ignored and l.files_ready)::int as available
       from products p where p.type = 'physical' and p.archived_at is null order by p.title`,
  )
  const jobs = await q<{ state: string; n: number }>(`select state, count(*)::int as n from printful_orders group by state`)
  return { ...base, products, jobs: Object.fromEntries(jobs.map((j) => [j.state, j.n])) }
}

/** Read only checks against the real Printful account. Nothing is created or charged. */
export async function safeChecks(addressInput?: unknown) {
  const out: Array<{ check: string; ok: boolean; detail: string }> = []
  const run = async (check: string, fn: () => Promise<string>) => {
    try {
      out.push({ check, ok: true, detail: await fn() })
    } catch (err) {
      out.push({ check, ok: false, detail: (err as Error).message })
    }
  }
  await run('Connect with the API token', async () => {
    const stores = await printfulStores()
    if (!stores.length) throw new Error('The token can see no stores.')
    const pick = config.printful.storeId ? stores.find((s) => String(s.id) === config.printful.storeId) : stores.length === 1 ? stores[0] : null
    if (!pick) throw new Error(`The token can see ${stores.length} stores (${stores.map((s) => `${s.name} #${s.id}`).join(', ')}). Set PRINTFUL_STORE_ID to the right one.`)
    return `Store "${pick.name}" (#${pick.id}${pick.type ? `, ${pick.type}` : ''}).`
  })
  await run('Read the store products', async () => `${(await syncProducts()).length} products found in Printful.`)
  await run('Check linked items', async () => {
    const n = await refreshLinks(undefined, 200)
    const bad = await q<LinkRow>('select * from printful_links')
    const problems = bad.filter((l) => !linkAvailable(l))
    if (problems.length) throw new Error(`${problems.length} of ${bad.length} linked items cannot be made right now: ${problems.slice(0, 5).map((l) => `${l.name}: ${linkProblem(l)}`).join(' ')}`)
    return `${n} linked items checked; all can be made.`
  })
  const sample = await one<LinkRow>(`select * from printful_links where availability = 'active' and synced and not ignored and files_ready limit 1`)
  if (sample && addressInput) {
    await run('Quote shipping for a sample address', async () => {
      const a = parseAddress(addressInput, (await getSettings()).shipping.countries)
      const rates = await printful<PfShippingRate[]>('POST', '/shipping/rates', { recipient: recipientFor(a), items: [{ variant_id: Number(sample.catalog_variant_id), quantity: 1 }], currency: 'USD', locale: 'en_US' })
      return rates.map((r) => `${r.name}: $${r.rate}`).join('; ') || 'No options returned.'
    })
    await run('Estimate an order cost (nothing is created)', async () => {
      const a = parseAddress(addressInput, (await getSettings()).shipping.countries)
      const est = await printful<{ costs?: Record<string, unknown> }>('POST', '/orders/estimate-costs', {
        recipient: { ...recipientFor(a), name: a.name },
        items: [{ sync_variant_id: Number(sample.sync_variant_id), quantity: 1 }],
      })
      return `Printful would charge about ${String(est.costs?.total ?? '?')} ${String(est.costs?.currency ?? '')} for one ${sample.name}, shipping included.`
    })
  }
  await run('Webhook address', async () => {
    const w = await webhookStatus()
    if (!w.url) throw new Error('No webhook is set in Printful. Use "Point Printful webhooks here".')
    if (!w.ours) throw new Error(`Printful sends webhooks to ${w.url}, not this site.`)
    return `Set to this site for: ${w.types.join(', ')}.`
  })
  return out
}
