/*
  Email automations: a download reminder and review requests.

  * Download reminder: some days after confirmed payment, for purchased
    digital items whose download is still unused and available.
  * Digital review request: some days after confirmed payment.
  * Physical review request: some days after CONFIRMED DELIVERY of the
    shipment holding the item (never purchase, shipment or an estimate).

  Requests are rows in email_jobs, created when a payment is confirmed and
  only for automations that are switched on at that moment, so customers from
  before an automation was switched on are never emailed. Physical requests
  wait ("held, waiting for confirmed delivery") until delivery is confirmed.

  The scheduled job (/api/cron/maintenance, hourly) claims due rows with
  FOR UPDATE SKIP LOCKED, rechecks everything right before sending, groups
  items from the same order (and shipment) into one email, and hands it to
  the existing email outbox with a stable idempotency key. A request becomes
  eligible at its due time and goes out on the next run; after downtime,
  overdue requests go out on the next run, still rechecked.

  These emails never grant, reset or use a download. Their links open the
  signed in account area (My downloads, or a product's review form); opening
  an email or clicking a link changes nothing.
*/
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from '../auth.js'
import { one, q, tx, type Queryable } from '../db/pool.js'
import { kickDispatcher, loadTemplate, queueEmail } from '../email/outbox.js'
import { defaultTemplates, renderEmail, validateTemplate, type EmailType, type TemplateText } from '../email/templates.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { isEligible } from './reviews.js'
import { getSettings, setSetting } from './settings.js'

export type AutomationKind = 'download_reminder' | 'digital_review' | 'physical_review'
export const AUTOMATION_KINDS: AutomationKind[] = ['download_reminder', 'digital_review', 'physical_review']
export const TEMPLATE_FOR: Record<AutomationKind, EmailType> = { download_reminder: 'download_reminder', digital_review: 'review_request_digital', physical_review: 'review_request_physical' }
type Preference = 'download_reminders' | 'review_requests'
const PREFERENCE_FOR: Record<AutomationKind, Preference> = { download_reminder: 'download_reminders', digital_review: 'review_requests', physical_review: 'review_requests' }
const LABEL: Record<AutomationKind, string> = { download_reminder: 'Download reminders', digital_review: 'Digital review requests', physical_review: 'Physical review requests' }

interface Automation {
  kind: AutomationKind
  enabled: boolean
  delay_days: number
  /** Also for free Freebie Corner claims (off unless the owner turns it on). */
  include_freebies: boolean
  updated_at: string
  updated_by: string | null
}

export async function automationSettings(client?: Queryable) {
  // The defaults (all switched off) are restored if the rows are ever missing.
  await q(`insert into email_automations (kind, delay_days) values ('download_reminder',3),('digital_review',7),('physical_review',14) on conflict (kind) do nothing`, [], client)
  const rows = await q<Automation>('select kind, enabled, delay_days, include_freebies, updated_at, updated_by from email_automations', [], client)
  return Object.fromEntries(rows.map((r) => [r.kind, r])) as Record<AutomationKind, Automation>
}

/* ---------- Scheduling ---------- */

async function insertJob(
  client: Queryable,
  j: { kind: AutomationKind; key: string; status: 'scheduled' | 'held'; hold: string; reason: string; userId: string; orderId: string; itemId: string; productId: string; startAt: string | null; delayDays: number },
) {
  // A repeat purchase only replaces a request that was skipped or canceled; never one that was sent or is pending.
  await q(
    `insert into email_jobs (kind, dedupe_key, status, hold_reason, status_reason, user_id, order_id, order_item_id, product_id, start_at, due_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz, $10::timestamptz + make_interval(days => $11))
     on conflict (dedupe_key) do update set kind = excluded.kind, status = excluded.status, hold_reason = excluded.hold_reason, status_reason = excluded.status_reason,
       order_id = excluded.order_id, order_item_id = excluded.order_item_id, product_id = excluded.product_id, shipment_id = null, start_at = excluded.start_at,
       due_at = excluded.due_at, attempts = 0, last_error = '', email_id = null, sent_at = null, canceled_by = null, claimed_at = null, updated_at = now()
     where email_jobs.status in ('skipped','canceled')`,
    [j.kind, j.key, j.status, j.hold, j.reason, j.userId, j.orderId, j.itemId, j.productId, j.startAt, j.delayDays],
    client,
  )
}

/**
 * Called inside the payment transaction (and harmless to call again).
 * Uses the confirmed payment time stored on the order.
 */
export async function scheduleForPaidOrder(orderId: string, client: Queryable) {
  const order = await one<{ id: string; user_id: string | null; paid_at: string | null; is_demo: boolean; status: string }>('select id, user_id, paid_at, is_demo, status from orders where id = $1', [orderId], client)
  if (!order?.user_id || !order.paid_at || order.is_demo || order.status !== 'paid') return
  const s = await automationSettings(client)
  const items = await q<{ id: string; product_id: string; product_type: string; is_freebie: boolean }>('select id, product_id, product_type, is_freebie from order_items where order_id = $1', [orderId], client)
  const base = { userId: order.user_id, orderId: order.id, startAt: order.paid_at }
  for (const it of items) {
    const reviewKey = `review:${order.user_id}:${it.product_id}`
    if (it.product_type === 'digital') {
      // Free claims get these emails only if the owner chose that for the automation.
      if (it.is_freebie) {
        if (s.download_reminder?.enabled && s.download_reminder.include_freebies) await insertJob(client, { ...base, kind: 'download_reminder', key: `download_reminder:${it.id}`, status: 'scheduled', hold: '', reason: '', itemId: it.id, productId: it.product_id, delayDays: s.download_reminder.delay_days })
        continue
      }
      if (s.download_reminder?.enabled) await insertJob(client, { ...base, kind: 'download_reminder', key: `download_reminder:${it.id}`, status: 'scheduled', hold: '', reason: '', itemId: it.id, productId: it.product_id, delayDays: s.download_reminder.delay_days })
      if (s.digital_review?.enabled) await insertJob(client, { ...base, kind: 'digital_review', key: reviewKey, status: 'scheduled', hold: '', reason: '', itemId: it.id, productId: it.product_id, delayDays: s.digital_review.delay_days })
    } else if (s.physical_review?.enabled) {
      await insertJob(client, { ...base, kind: 'physical_review', key: reviewKey, status: 'held', hold: 'awaiting_delivery', reason: 'Waiting for a confirmed delivery.', itemId: it.id, productId: it.product_id, startAt: null, delayDays: s.physical_review.delay_days })
    }
  }
}

async function itemsOfShipment(shipmentId: string, client: Queryable) {
  const sh = await one<{ order_id: string; delivered_at: string | null }>('select order_id, delivered_at from shipments where id = $1', [shipmentId], client)
  if (!sh) return null
  const { shipmentItemIds } = await import('./delivery.js')
  return { ...sh, itemIds: await shipmentItemIds(shipmentId, sh.order_id, client) }
}

/** Delivery confirmed (or corrected): physical requests for that shipment's items count from the delivery time. */
export async function scheduleDelivered(shipmentId: string, client: Queryable) {
  const sh = await itemsOfShipment(shipmentId, client)
  if (!sh?.delivered_at || !sh.itemIds.length) return
  const s = (await automationSettings(client)).physical_review
  await q(
    `update email_jobs set shipment_id = $1, start_at = $3::timestamptz, due_at = $3::timestamptz + make_interval(days => $4),
       status = case when hold_reason = 'automation_off' or not $5 then 'held' else 'scheduled' end,
       hold_reason = case when hold_reason = 'automation_off' or not $5 then 'automation_off' else '' end,
       status_reason = case when hold_reason = 'automation_off' or not $5 then 'Physical review requests are switched off.' else '' end,
       updated_at = now()
     where kind = 'physical_review' and order_item_id = any($2) and status in ('held','scheduled') and (shipment_id is null or shipment_id = $1)`,
    [shipmentId, sh.itemIds, sh.delivered_at, s.delay_days, s.enabled],
    client,
  )
}

export async function holdForDeliveryProblem(shipmentId: string, problem: string, client: Queryable) {
  const sh = await itemsOfShipment(shipmentId, client)
  if (!sh?.itemIds.length) return
  await q(
    `update email_jobs set status = 'held', hold_reason = 'delivery_problem', status_reason = $3, shipment_id = $1, updated_at = now()
     where kind = 'physical_review' and order_item_id = any($2) and status in ('held','scheduled') and (shipment_id is null or shipment_id = $1)`,
    [shipmentId, sh.itemIds, `Delivery problem: ${problem}`],
    client,
  )
}

export async function releaseDeliveryProblem(shipmentId: string, client: Queryable) {
  await q(
    `update email_jobs set hold_reason = 'awaiting_delivery', status_reason = 'Waiting for a confirmed delivery.', updated_at = now()
     where kind = 'physical_review' and shipment_id = $1 and status = 'held' and hold_reason = 'delivery_problem'`,
    [shipmentId],
    client,
  )
}

/* ---------- Processing ---------- */

interface Job {
  id: string
  kind: AutomationKind
  status: string
  user_id: string | null
  order_id: string
  order_item_id: string
  product_id: string
  shipment_id: string | null
  due_at: string
  attempts: number
}

const ORDER_SKIP: Record<string, string> = {
  pending: 'The order is not paid.',
  failed: 'The payment failed.',
  canceled: 'The order was canceled.',
  refunded: 'The order was refunded.',
  disputed: 'The payment is disputed.',
}

/** Links for the customer. Opening them changes nothing; signing in returns the customer to the same page. */
export const downloadsUrl = () => `${config.appUrl}/#account-downloads`
export const reviewUrl = (productId: string) => `${config.appUrl}/#account-review-${productId}`

function preferenceToken(userId: string, pref: Preference) {
  const payload = Buffer.from(`${userId}:${pref}`).toString('base64url')
  const sig = createHmac('sha256', config.authSecret).update(`email-pref:${payload}`).digest('base64url').slice(0, 32)
  return `${payload}.${sig}`
}
export const preferenceUrl = (userId: string, pref: Preference) => `${config.appUrl}/#email-preferences?t=${preferenceToken(userId, pref)}`
const preferenceText: Record<Preference, string> = { download_reminders: 'Stop download reminder emails', review_requests: 'Stop review request emails' }

const footerFor: Record<AutomationKind, string> = {
  download_reminder: 'Each purchase includes one download. Opening this email, signing in or looking at My downloads never uses it; only pressing Download does.',
  digital_review: 'We ask everyone who bought these, and every honest review is welcome. There is no reward for reviewing.',
  physical_review: 'We ask everyone who bought these, and every honest review is welcome. There is no reward for reviewing.',
}

async function productItems(kind: AutomationKind, rows: Array<{ product_id: string; title: string }>, client?: Queryable) {
  const ids = rows.map((r) => r.product_id)
  const imgs = await q<{ product_id: string; image_id: string | null }>(
    `select p.id as product_id,
            (select i.id from product_images i where i.product_id = p.id and i.kind = 'gallery' and i.approved order by i.sort_order limit 1) as image_id
       from products p where p.id = any($1) and p.status = 'published' and p.active and p.archived_at is null`,
    [ids],
    client,
  )
  return rows.map((r) => {
    const img = imgs.find((x) => x.product_id === r.product_id)?.image_id
    return { title: r.title, imageUrl: img ? `${config.appUrl}/api/media/${img}` : null, url: kind === 'download_reminder' ? undefined : reviewUrl(r.product_id) }
  })
}

async function processGroup(jobs: Job[]) {
  const kind = jobs[0].kind
  const ids = jobs.map((j) => j.id)
  const queued = await tx(async (client) => {
    const auto = (await automationSettings(client))[kind]
    const setMany = (status: string, reason: string, list: string[], hold = '') =>
      list.length ? q(`update email_jobs set status = $2, status_reason = $3, hold_reason = $4, claimed_at = null, updated_at = now() where id = any($1)`, [list, status, reason, hold], client) : null
    if (!auto.enabled) {
      await setMany('held', `${LABEL[kind]} are switched off.`, ids, 'automation_off')
      return false
    }
    const order = await one<{ id: string; status: string; is_demo: boolean; order_number: string; user_id: string | null; email: string | null; name: string | null; pref_dl: boolean | null; pref_rv: boolean | null; suppressed: boolean }>(
      `select o.id, o.status, o.is_demo, o.order_number, o.user_id, u.email, u.name, cp.download_reminders as pref_dl, cp.review_requests as pref_rv,
              exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed
         from orders o left join "user" u on u.id = o.user_id left join customer_profiles cp on cp.user_id = o.user_id where o.id = $1`,
      [jobs[0].order_id],
      client,
    )
    const pref = PREFERENCE_FOR[kind] === 'download_reminders' ? order?.pref_dl : order?.pref_rv
    let orderReason: string | null = null
    if (!order) orderReason = 'The order no longer exists.'
    else if (!order.user_id || !order.email) orderReason = 'The customer account no longer exists.'
    else if (order.is_demo) orderReason = 'Demo or test order.'
    else if (!['paid', 'partially_refunded'].includes(order.status)) orderReason = ORDER_SKIP[order.status] ?? 'The order is not paid.'
    else if (pref === false) orderReason = `The customer turned off ${PREFERENCE_FOR[kind] === 'download_reminders' ? 'download reminders' : 'review requests'}.`
    else if (order.suppressed) orderReason = 'The email address is suppressed after a bounce or complaint.'
    if (orderReason) {
      await setMany('skipped', orderReason, ids)
      return false
    }
    const eligible: Array<{ job: Job; title: string }> = []
    for (const job of jobs) {
      const item = await one<{ title_snapshot: string; quantity: number; refunded_quantity: number }>('select title_snapshot, quantity, refunded_quantity from order_items where id = $1', [job.order_item_id], client)
      let reason: string | null = null
      if (!item) reason = 'The order item no longer exists.'
      else if (item.refunded_quantity >= item.quantity) reason = 'This item was fully refunded.'
      else if (kind === 'download_reminder') {
        const e = await one<{ available: number; redeemed: number; revoked: number }>(
          `select count(*) filter (where status = 'available')::int as available, count(*) filter (where status = 'redeemed')::int as redeemed,
                  count(*) filter (where status = 'revoked')::int as revoked from entitlements where order_item_id = $1`,
          [job.order_item_id],
          client,
        )
        if (e!.redeemed > 0) reason = 'Already downloaded.'
        else if (e!.available === 0) reason = e!.revoked > 0 ? 'The download was revoked.' : 'No download is available for this item.'
      } else {
        if (await one('select 1 from reviews where user_id = $1 and product_id = $2', [order!.user_id, job.product_id], client)) reason = 'The customer already reviewed this product.'
        else if (!(await isEligible(order!.user_id!, job.product_id))) reason = 'Not eligible to review (refunded or not paid).'
        else if (kind === 'physical_review') {
          const sh = job.shipment_id ? await one<{ delivered_at: string | null; status: string }>('select delivered_at, status from shipments where id = $1', [job.shipment_id], client) : null
          if (!sh?.delivered_at || sh.status !== 'delivered') {
            await setMany('held', 'Waiting for a confirmed delivery.', [job.id], 'awaiting_delivery')
            continue
          }
        }
      }
      if (reason) await setMany('skipped', reason, [job.id])
      else eligible.push({ job, title: item!.title_snapshot })
    }
    if (!eligible.length) return false
    const items = await productItems(
      kind,
      eligible.map((e) => ({ product_id: e.job.product_id, title: e.title })),
      client,
    )
    const pref2 = PREFERENCE_FOR[kind]
    const key = createHash('sha256').update(eligible.map((e) => e.job.id).sort().join(',')).digest('hex').slice(0, 40)
    const emailId = await queueEmail(
      {
        type: TEMPLATE_FOR[kind],
        to: order!.email!,
        userId: order!.user_id,
        orderId: order!.id,
        vars: { name: (order!.name ?? '').trim().split(/\s+/)[0] || 'there', order_number: order!.order_number },
        items,
        footerNote: footerFor[kind],
        preference: { url: preferenceUrl(order!.user_id!, pref2), text: preferenceText[pref2] },
        idempotencyKey: `automation:${kind}:${key}`,
      },
      client,
    )
    await q(`update email_jobs set status = 'sent', email_id = $2, sent_at = now(), status_reason = '', last_error = '', claimed_at = null, updated_at = now() where id = any($1)`, [eligible.map((e) => e.job.id), emailId], client)
    return true
  })
  return queued
}

/**
 * Sends due requests. Safe to run at the same time on several instances:
 * each request is claimed by one run only, and the email itself has a
 * stable idempotency key.
 */
export async function runAutomations(opts: { now?: Date; max?: number } = {}) {
  const now = opts.now ?? new Date()
  // A run that stopped mid way releases its claims after ten minutes.
  await q(`update email_jobs set status = 'scheduled', claimed_at = null, updated_at = now() where status = 'processing' and claimed_at < now() - interval '10 minutes'`)
  let handled = 0
  let emails = 0
  while (handled < (opts.max ?? 500)) {
    const claimed = await q<Job>(
      `update email_jobs set status = 'processing', claimed_at = now(), attempts = attempts + 1, updated_at = now()
        where id in (select id from email_jobs where status = 'scheduled' and due_at <= $1 order by due_at, order_id for update skip locked limit 50)
        returning id, kind, status, user_id, order_id, order_item_id, product_id, shipment_id, due_at, attempts`,
      [now.toISOString()],
    )
    if (!claimed.length) break
    handled += claimed.length
    const groups = new Map<string, Job[]>()
    for (const j of claimed) {
      const k = `${j.kind}|${j.order_id}|${j.shipment_id ?? ''}`
      groups.set(k, [...(groups.get(k) ?? []), j])
    }
    for (const group of groups.values()) {
      try {
        if (await processGroup(group)) emails++
      } catch (err) {
        // A temporary problem: try again on the next run, up to five times.
        await q(
          `update email_jobs set status = case when attempts >= 5 then 'failed' else 'scheduled' end, last_error = $2, claimed_at = null,
                  status_reason = case when attempts >= 5 then 'Could not be prepared after five tries.' else status_reason end, updated_at = now()
            where id = any($1) and status = 'processing'`,
          [group.map((g) => g.id), (err as Error).message.slice(0, 500)],
        )
      }
    }
  }
  if (emails) kickDispatcher()
  return { handled, emails }
}

/* ---------- Admin ---------- */

export async function automationOverview() {
  const settings = await automationSettings()
  const counts = await q<{ kind: AutomationKind; status: string; hold_reason: string; n: number }>(
    `select kind, status, hold_reason, count(*)::int as n from email_jobs group by kind, status, hold_reason`,
  )
  const templates: Record<string, TemplateText & { customized: boolean }> = {}
  for (const kind of AUTOMATION_KINDS) {
    const row = await one<TemplateText>('select subject, heading, body, button_label from email_templates where type = $1', [TEMPLATE_FOR[kind]])
    templates[kind] = { ...(row ?? defaultTemplates[TEMPLATE_FOR[kind]]), customized: Boolean(row) }
  }
  return {
    automations: AUTOMATION_KINDS.map((k) => ({
      ...settings[k],
      label: LABEL[k],
      startsFrom: k === 'physical_review' ? 'confirmed delivery' : 'confirmed payment',
      template: templates[k],
      templateType: TEMPLATE_FOR[k],
      counts: Object.fromEntries(['scheduled', 'held', 'sent', 'skipped', 'failed', 'canceled'].map((st) => [st, counts.filter((c) => c.kind === k && c.status === st).reduce((n, c) => n + c.n, 0)])),
      heldSwitchedOff: counts.filter((c) => c.kind === k && c.status === 'held' && c.hold_reason === 'automation_off').reduce((n, c) => n + c.n, 0),
    })),
    timezone: (await getSettings()).store.timezone,
    email: { configured: Boolean(config.resend.apiKey && config.resend.from) },
    scheduler: { configured: Boolean(config.cronSecret) },
    deliveryTracking: { configured: Boolean(config.deliveryWebhookSecret) },
  }
}

export async function listJobs(f: { kind?: string; status?: string; orderId?: string; limit?: number; offset?: number }) {
  const where = ['true']
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replace('$?', `$${params.length}`))
  }
  if (f.kind) add('j.kind = $?', f.kind)
  if (f.orderId) add('j.order_id = $?', f.orderId)
  if (f.status === 'failed') where.push(`(j.status = 'failed' or (j.status = 'sent' and e.status in ('failed','bounced','not_configured')))`)
  else if (f.status === 'sent') where.push(`(j.status = 'sent' and coalesce(e.status,'') not in ('failed','bounced','not_configured','suppressed'))`)
  else if (f.status === 'skipped') where.push(`(j.status = 'skipped' or (j.status = 'sent' and e.status = 'suppressed'))`)
  else if (f.status) add('j.status = $?', f.status)
  params.push(Math.min(f.limit ?? 100, 300), f.offset ?? 0)
  const rows = await q<Record<string, any>>(
    `select j.id, j.kind, j.status, j.hold_reason, j.status_reason, j.start_at, j.due_at, j.sent_at, j.attempts, j.last_error, j.created_at, j.updated_at,
            j.order_id, o.order_number, j.user_id, u.email as customer_email, u.name as customer_name,
            j.product_id, oi.title_snapshot as product_title, p.slug as product_slug,
            j.shipment_id, s.carrier, s.tracking_number, s.status as shipment_status, s.shipped_at, s.delivered_at, s.delivery_source, s.problem,
            j.email_id, e.status as email_status, e.failure_reason as email_failure, e.resend_id
       from email_jobs j join orders o on o.id = j.order_id join order_items oi on oi.id = j.order_item_id join products p on p.id = j.product_id
       left join "user" u on u.id = j.user_id left join shipments s on s.id = j.shipment_id left join emails e on e.id = j.email_id
      where ${where.join(' and ')} order by coalesce(j.due_at, j.created_at) desc limit $${params.length - 1} offset $${params.length}`,
    params,
  )
  // What actually happened to the email decides what the owner sees: an email
  // waiting for Resend or rejected is never shown as sent.
  return rows.map((r) => {
    let display = r.status === 'processing' ? 'scheduled' : r.status
    let reason = r.status_reason
    if (r.status === 'sent') {
      if (r.email_status === 'not_configured') (display = 'failed'), (reason = 'Not sent: email sending is awaiting Resend configuration.')
      else if (r.email_status === 'failed' || r.email_status === 'bounced') (display = 'failed'), (reason = r.email_failure || 'The email could not be delivered.')
      else if (r.email_status === 'suppressed') (display = 'skipped'), (reason = r.email_failure || 'Suppressed.')
      else if (r.email_status === 'queued' || r.email_status === 'sending') reason = 'Handed to the email outbox; sending now.'
    }
    if (r.kind === 'physical_review' && r.status === 'held' && r.hold_reason === 'awaiting_delivery' && r.shipped_at && !r.delivered_at) {
      const days = Math.floor((Date.now() - new Date(r.shipped_at).getTime()) / 86_400_000)
      if (days >= 21) reason = `No delivery confirmation ${days} days after shipping. Record the delivery date if you know it.`
    }
    return { ...r, display_status: display, display_reason: reason }
  })
}

export async function updateAutomation(actor: SessionUser, kind: AutomationKind, b: Record<string, unknown>, ip?: string) {
  const cur = (await automationSettings())[kind]
  if (!cur) throw notFound('Automation')
  const enabled = b.enabled === undefined ? cur.enabled : Boolean(b.enabled)
  const delay = b.delay_days === undefined ? cur.delay_days : Math.round(Number(b.delay_days))
  const includeFreebies = b.include_freebies === undefined ? cur.include_freebies : b.include_freebies === true
  if (!Number.isInteger(delay) || delay < 1 || delay > 90) throw badRequest('The delay must be between 1 and 90 days.')
  return tx(async (client) => {
    await q('update email_automations set enabled = $2, delay_days = $3, include_freebies = $5, updated_at = now(), updated_by = $4 where kind = $1', [kind, enabled, delay, actor.email, includeFreebies], client)
    let held = 0
    if (cur.enabled && !enabled) {
      // Switching off stops pending emails: they are held until the owner resumes or cancels them.
      held = (
        await q(`update email_jobs set status = 'held', hold_reason = 'automation_off', status_reason = $2, updated_at = now() where kind = $1 and status = 'scheduled' returning id`, [kind, `${LABEL[kind]} are switched off.`], client)
      ).length
    }
    const parts = [
      cur.enabled !== enabled ? (enabled ? 'switched on' : `switched off (${held} pending held)`) : null,
      cur.delay_days !== delay ? `delay ${cur.delay_days} to ${delay} days (future purchases)` : null,
      cur.include_freebies !== includeFreebies ? (includeFreebies ? 'free claims included' : 'free claims excluded') : null,
    ].filter(Boolean)
    if (parts.length) await audit({ actor, action: 'automation.updated', entityType: 'email_automation', entityId: kind, summary: `${LABEL[kind]}: ${parts.join('; ')}`, ip }, client)
    return { held }
  })
}

/** After switching back on: resume the held requests (overdue ones go out on the next run) or cancel them. */
export async function resolveHeld(actor: SessionUser, kind: AutomationKind, action: 'resume' | 'cancel', ip?: string) {
  const auto = (await automationSettings())[kind]
  if (action === 'resume' && !auto.enabled) throw badRequest('Switch the automation on before resuming its held emails.')
  const rows =
    action === 'resume'
      ? await q(
          `update email_jobs set status = case when start_at is null then 'held' else 'scheduled' end,
                  hold_reason = case when start_at is null then 'awaiting_delivery' else '' end,
                  status_reason = case when start_at is null then 'Waiting for a confirmed delivery.' else '' end, updated_at = now()
            where kind = $1 and status = 'held' and hold_reason = 'automation_off' returning id`,
          [kind],
        )
      : await q(`update email_jobs set status = 'canceled', status_reason = 'Canceled after the automation was switched off.', canceled_by = $2, updated_at = now() where kind = $1 and status = 'held' and hold_reason = 'automation_off' returning id`, [kind, actor.email])
  await audit({ actor, action: `automation.held_${action}d`, entityType: 'email_automation', entityId: kind, summary: `${LABEL[kind]}: ${action === 'resume' ? 'resumed' : 'canceled'} ${rows.length} held emails`, ip })
  return { count: rows.length }
}

/** Applies the current delay to pending requests. Only on the owner's explicit request. */
export async function reschedulePending(actor: SessionUser, kind: AutomationKind, ip?: string) {
  const auto = (await automationSettings())[kind]
  const rows = await q(
    `update email_jobs set due_at = start_at + make_interval(days => $2), updated_at = now() where kind = $1 and status in ('scheduled','held') and start_at is not null returning id`,
    [kind, auto.delay_days],
  )
  await audit({ actor, action: 'automation.rescheduled', entityType: 'email_automation', entityId: kind, summary: `${LABEL[kind]}: rescheduled ${rows.length} pending emails to ${auto.delay_days} days`, ip })
  return { count: rows.length }
}

export async function cancelJob(actor: SessionUser, id: string, ip?: string) {
  const row = await one<{ kind: AutomationKind; order_id: string }>(
    `update email_jobs set status = 'canceled', status_reason = 'Canceled by the owner.', canceled_by = $2, updated_at = now() where id = $1 and status in ('scheduled','held') returning kind, order_id`,
    [id, actor.email],
  )
  if (!row) throw badRequest('Only scheduled or held emails can be canceled.')
  await audit({ actor, action: 'automation.request_canceled', entityType: 'order', entityId: row.order_id, summary: `Canceled a pending ${LABEL[row.kind].toLowerCase().replace(/s$/, '')}`, data: { jobId: id }, ip })
}

/** The store timezone used for admin dates. */
export async function setStoreTimezone(actor: SessionUser, tz: unknown, ip?: string) {
  const zone = String(tz ?? '').trim()
  if (zone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
    } catch {
      throw badRequest('That timezone is not recognized.')
    }
  }
  const store = (await getSettings()).store
  await setSetting('store', { ...store, timezone: zone }, actor, ip)
  return { timezone: zone }
}

/* ---------- Preview and test sends ---------- */

async function sampleItems(kind: AutomationKind) {
  const type = kind === 'physical_review' ? 'physical' : 'digital'
  const rows = await q<{ product_id: string; title: string }>(
    `select id as product_id, title from products where type = $1 and status = 'published' and active and archived_at is null order by sort_order, created_at limit 2`,
    [type],
  )
  const list = rows.length ? rows : [{ product_id: '00000000-0000-0000-0000-000000000000', title: type === 'digital' ? 'Sample digital resource' : 'Sample physical item' }]
  return productItems(kind, list)
}

function cleanTemplate(kind: AutomationKind, t: Partial<TemplateText>) {
  const clean = { subject: String(t.subject ?? ''), heading: String(t.heading ?? ''), body: String(t.body ?? ''), button_label: String(t.button_label ?? '') }
  const errors = validateTemplate(TEMPLATE_FOR[kind], clean)
  if (errors.length) throw badRequest(errors.join(' '))
  return clean
}

/** Renders the email with sample details. With template text, previews unsaved edits. */
export async function previewAutomation(kind: AutomationKind, t?: Partial<TemplateText>) {
  const template = t ? cleanTemplate(kind, t) : await loadTemplate(TEMPLATE_FOR[kind])
  const pref = PREFERENCE_FOR[kind]
  return renderEmail({
    template,
    vars: { name: 'Taylor', order_number: 'NLC-10001' },
    buttonUrl: kind === 'download_reminder' ? downloadsUrl() : undefined,
    items: await sampleItems(kind),
    footerNote: footerFor[kind],
    preference: { url: `${config.appUrl}/#email-preferences`, text: preferenceText[pref] },
  })
}

/** Sends the saved email, with sample details, to an address the owner chooses. Changes no schedules, reviews or downloads. */
export async function testSend(actor: SessionUser, kind: AutomationKind, toInput: unknown, ip?: string) {
  const to = String(toInput ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) throw badRequest('Please enter a valid test email address.')
  const pref = PREFERENCE_FOR[kind]
  const id = await queueEmail({
    type: TEMPLATE_FOR[kind],
    to,
    vars: { name: 'Taylor', order_number: 'NLC-10001' },
    items: await sampleItems(kind),
    footerNote: footerFor[kind],
    preference: { url: `${config.appUrl}/#email-preferences`, text: preferenceText[pref] },
    subjectPrefix: '[Test] ',
    idempotencyKey: `automation-test:${kind}:${randomUUID()}`,
  })
  await audit({ actor, action: 'automation.test_sent', entityType: 'email_automation', entityId: kind, summary: `Sent a test ${LABEL[kind].toLowerCase().replace(/s$/, '')} to ${to}`, data: { emailId: id }, ip })
  return { emailId: id }
}

/* ---------- Customer preferences from an email link ---------- */

export function readPreferenceToken(token: string): { userId: string; pref: Preference } | null {
  const [payload, sig] = String(token ?? '').split('.')
  if (!payload || !sig) return null
  const want = createHmac('sha256', config.authSecret).update(`email-pref:${payload}`).digest('base64url').slice(0, 32)
  const a = Buffer.from(sig)
  const b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const [userId, pref] = Buffer.from(payload, 'base64url').toString().split(':')
  if (!userId || (pref !== 'download_reminders' && pref !== 'review_requests')) return null
  return { userId, pref }
}

const mask = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, '$1•••$2')

/** What the email link page shows: which emails, for which (masked) address, and whether they are on. Reading changes nothing. */
export async function preferenceStatus(token: string) {
  const t = readPreferenceToken(token)
  if (!t) throw badRequest('This link is not valid. You can change email preferences in your account.')
  const u = await one<{ email: string; on: boolean | null }>(`select u.email, cp.${t.pref} as on from "user" u left join customer_profiles cp on cp.user_id = u.id where u.id = $1`, [t.userId])
  if (!u) throw notFound('Account')
  return { preference: t.pref, label: t.pref === 'download_reminders' ? 'download reminder emails' : 'review request emails', email: mask(u.email), subscribed: u.on !== false }
}

/** Changes only that one preference, after the customer presses the button on the page. */
export async function setPreferenceFromLink(token: string, subscribed: boolean) {
  const t = readPreferenceToken(token)
  if (!t) throw badRequest('This link is not valid. You can change email preferences in your account.')
  await q(
    `insert into customer_profiles (user_id, ${t.pref}) values ($1,$2) on conflict (user_id) do update set ${t.pref} = excluded.${t.pref}, updated_at = now()`,
    [t.userId, subscribed],
  )
  return preferenceStatus(token)
}
