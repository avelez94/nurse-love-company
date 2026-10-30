/*
  Digital download entitlements.

  Policy (enforced here and by unique indexes in the database):
  * Each purchased digital product line receives ONE download entitlement for
    the latest released version of the file.
  * An entitlement can be redeemed once. Viewing the dashboard, previewing a
    product, resending an email or resetting a password never grants or
    consumes anything.
  * Releasing a new version (saving the product with a new file) gives each
    eligible prior purchaser exactly one new entitlement for that version. Any older
    unredeemed entitlement for the same purchase is marked "superseded", so
    unused downloads never stack and an update never restores an old version.
  * Downloads require a signed in customer who owns a paid, unrefunded order.
  * Delivery uses a short lived, single use token tied to the session. The
    entitlement is consumed atomically at the moment delivery starts, after
    the file has been opened successfully. If the file cannot be opened, the
    entitlement is not used.
  * Once bytes start flowing, the server cannot prove the file was saved. A
    customer can report a problem, and an admin can grant an audited
    replacement entitlement with a reason. Nothing is ever reset silently.
*/
import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { SessionUser } from '../auth.js'
import { one, q, tx, type Queryable } from '../db/pool.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import { rateLimit } from '../lib/rate-limit.js'
import { storage } from '../lib/storage.js'

/** Orders whose digital lines may hold downloads. */
export const ELIGIBLE_ORDER_STATUSES = ['paid', 'partially_refunded'] as const

const eligibleItemCondition = `o.status in ('paid','partially_refunded') and oi.refunded_quantity < oi.quantity and oi.product_type = 'digital'`

async function logEvent(e: { entitlementId?: string | null; userId?: string | null; versionId?: string | null; event: string; detail?: string; ip?: string; ua?: string }, client?: Queryable) {
  await q(`insert into download_events (entitlement_id, user_id, version_id, event, detail, ip, user_agent) values ($1,$2,$3,$4,$5,$6,$7)`, [e.entitlementId ?? null, e.userId ?? null, e.versionId ?? null, e.event, e.detail ?? '', e.ip ?? null, e.ua ?? null], client)
}

/**
 * Grants the purchase entitlement for each digital line of a paid order.
 * Safe to call repeatedly: the unique indexes make extra calls no-ops.
 */
export async function grantPurchaseEntitlements(orderId: string, client: PoolClient) {
  const rows = await q<{ order_item_id: string; user_id: string; product_id: string; version_id: string | null }>(
    `select oi.id as order_item_id, o.user_id, oi.product_id, p.current_version_id as version_id
       from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
      where oi.order_id = $1 and ${eligibleItemCondition} and o.user_id is not null
      for share of p`,
    [orderId],
    client,
  )
  let granted = 0
  for (const r of rows) {
    if (!r.version_id) continue // No file released yet. The first release will grant it.
    await q('update order_items set version_id_at_purchase = coalesce(version_id_at_purchase, $2) where id = $1', [r.order_item_id, r.version_id], client)
    const ins = await q(
      `insert into entitlements (user_id, product_id, order_item_id, version_id, source)
       select $1, $2, $3, $4, 'purchase'
        where not exists (select 1 from entitlements where order_item_id = $3)
       on conflict do nothing returning id`,
      [r.user_id, r.product_id, r.order_item_id, r.version_id],
      client,
    )
    granted += ins.length
  }
  return granted
}

/** How many purchases would receive the next release of a product. */
export async function countAffectedPurchasers(productId: string, client?: Queryable) {
  const row = await one<{ items: number; customers: number }>(
    `select count(*)::int as items, count(distinct o.user_id)::int as customers
       from order_items oi join orders o on o.id = oi.order_id
      where oi.product_id = $1 and ${eligibleItemCondition} and o.user_id is not null`,
    [productId],
    client,
  )
  return row ?? { items: 0, customers: 0 }
}

export interface ReleaseInput {
  productId: string
  uploadId: string
  notes: string
  /** Queue update notifications for customers who downloaded an older version. */
  notify: boolean
  idempotencyKey: string
  /** "save": the owner saved the product with a new file. "manual": the earlier release endpoint. */
  trigger?: 'save' | 'manual'
  actor: SessionUser
  ip?: string
}

export interface ReleaseResult {
  id: string
  version_id: string
  affected_count: number
  granted_count: number
  duplicate: boolean
  versionNumber: number | null
  notifications: number
}

/**
 * Releases a staged file as the product's new version inside the caller's
 * transaction: an immutable version, one new entitlement per eligible
 * purchase (older unused downloads are superseded, never stacked), and, when
 * notify is set, one notification row per customer who downloaded an older
 * version. Emails are sent afterwards from those rows, so an email problem
 * can never undo the release or remove download access.
 */
export async function releaseInTx(client: PoolClient, input: ReleaseInput): Promise<ReleaseResult> {
  const existing = await one<{ id: string; version_id: string; affected_count: number; granted_count: number }>('select id, version_id, affected_count, granted_count from product_releases where idempotency_key = $1', [input.idempotencyKey], client)
  if (existing) return { ...existing, duplicate: true, versionNumber: null, notifications: 0 }

  const product = await one<{ id: string; type: string; title: string }>('select id, type, title from products where id = $1 for update', [input.productId], client)
  if (!product) throw notFound('Product')
  if (product.type !== 'digital') throw badRequest('Only digital products have downloadable files.')

  const upload = await one<{ id: string; storage_key: string; file_name: string; content_type: string; file_size: number; sha256: string; released_version_id: string | null; product_id: string }>(
    'select * from product_file_uploads where id = $1 for update',
    [input.uploadId],
    client,
  )
  if (!upload || upload.product_id !== product.id) throw notFound('Uploaded file')
  if (upload.released_version_id) throw conflict('This file has already been released.')

  const next = await one<{ n: number }>('select coalesce(max(version_number), 0) + 1 as n from product_versions where product_id = $1', [product.id], client)
  const version = await one<{ id: string; version_number: number }>(
    `insert into product_versions (product_id, version_number, storage_key, file_name, content_type, file_size, sha256, notes, released_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, version_number`,
    [product.id, next!.n, upload.storage_key, upload.file_name, upload.content_type, upload.file_size, upload.sha256, input.notes, input.actor.email],
    client,
  )
  await q(`update product_file_uploads set released_version_id = $2, outcome = 'released' where id = $1`, [upload.id, version!.id], client)
  await q('update products set current_version_id = $2, updated_at = now() where id = $1', [product.id, version!.id], client)

  const items = await q<{ order_item_id: string; user_id: string }>(
    `select oi.id as order_item_id, o.user_id
       from order_items oi join orders o on o.id = oi.order_id
      where oi.product_id = $1 and ${eligibleItemCondition} and o.user_id is not null`,
    [product.id],
    client,
  )

  const release = await one<{ id: string }>(
    `insert into product_releases (product_id, version_id, idempotency_key, notify, affected_count, created_by, trigger) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [product.id, version!.id, input.idempotencyKey, input.notify, items.length, input.actor.email, input.trigger ?? 'manual'],
    client,
  )

  // Older unused downloads are replaced by the new version, never added to it.
  await q(`update entitlements set status = 'superseded', status_changed_at = now() where product_id = $1 and status = 'available'`, [product.id], client)

  let granted = 0
  for (const it of items) {
    const hadAny = await one('select 1 from entitlements where order_item_id = $1', [it.order_item_id], client)
    const ins = await q(
      `insert into entitlements (user_id, product_id, order_item_id, version_id, source, release_id)
       values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
      [it.user_id, product.id, it.order_item_id, version!.id, hadAny ? 'update' : 'purchase', release!.id],
      client,
    )
    granted += ins.length
  }

  let notifications = 0
  if (input.notify) {
    // A newer file replaces any notification that has not gone out yet: customers get one email, about the latest version.
    await q(
      `update update_notifications set status = 'canceled', status_reason = $2, updated_at = now() where product_id = $1 and status in ('scheduled','held')`,
      [product.id, `Replaced by version ${version!.version_number} before it was sent.`],
      client,
    )
    // Only customers who downloaded an older version, with a purchase that is still eligible, and never for demo orders.
    const recipients = await q<{ user_id: string }>(
      `select distinct o.user_id from order_items oi join orders o on o.id = oi.order_id
        where oi.product_id = $1 and ${eligibleItemCondition} and o.user_id is not null and not o.is_demo
          and exists (select 1 from entitlements e where e.user_id = o.user_id and e.product_id = $1 and e.status = 'redeemed' and e.version_id <> $2)`,
      [product.id, version!.id],
      client,
    )
    for (const r of recipients) {
      const ins = await q(
        `insert into update_notifications (release_id, product_id, version_id, user_id, dedupe_key) values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing returning id`,
        [release!.id, product.id, version!.id, r.user_id, `update:${r.user_id}:${product.id}:${version!.id}`],
        client,
      )
      notifications += ins.length
    }
  }
  await q('update product_releases set granted_count = $2 where id = $1', [release!.id, granted], client)
  await audit(
    {
      actor: input.actor,
      action: 'product.version_released',
      entityType: 'product',
      entityId: product.id,
      summary: `Released version ${version!.version_number} of ${product.title}${input.trigger === 'save' ? ' by saving a new file' : ''}. ${granted} new download${granted === 1 ? '' : 's'} granted; ${notifications} customer${notifications === 1 ? '' : 's'} to notify.`,
      data: { versionId: version!.id, releaseId: release!.id, notify: input.notify, affected: items.length, granted, notifications },
      ip: input.ip,
    },
    client,
  )
  return { id: release!.id, version_id: version!.id, affected_count: items.length, granted_count: granted, duplicate: false, versionNumber: version!.version_number, notifications }
}

/** The earlier explicit release (kept for the API). Retrying with the same idempotency key returns the original release. */
export async function publishRelease(input: ReleaseInput) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw badRequest('Missing confirmation key. Please reopen the release dialog.')
  return tx((client) => releaseInTx(client, input))
}

interface EntitlementRow {
  id: string
  user_id: string
  status: string
  version_id: string
  storage_key: string
  file_name: string
  content_type: string
  file_size: number
  order_status: string
  order_user_id: string | null
  refunded_quantity: number
  quantity: number
}

async function loadEntitlement(id: string, client?: Queryable) {
  return one<EntitlementRow>(
    `select e.id, e.user_id, e.status, e.version_id, v.storage_key, v.file_name, v.content_type, v.file_size,
            o.status as order_status, o.user_id as order_user_id, oi.refunded_quantity, oi.quantity
       from entitlements e
       join product_versions v on v.id = e.version_id
       join order_items oi on oi.id = e.order_item_id
       join orders o on o.id = oi.order_id
      where e.id = $1`,
    [id],
    client,
  )
}

function assertRedeemable(e: EntitlementRow | null, user: SessionUser): asserts e is EntitlementRow {
  // Another customer's entitlement looks exactly like a missing one.
  if (!e || e.user_id !== user.id || e.order_user_id !== user.id) throw notFound('Download')
  if (!(ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(e.order_status) || e.refunded_quantity >= e.quantity) {
    throw new HttpError(403, 'This download is not available because the order is not in a paid state.', 'order_ineligible')
  }
  if (e.status === 'redeemed') throw conflict('This download has already been used.', 'already_used')
  if (e.status === 'superseded') throw conflict('A newer version replaced this download. Refresh My Downloads to see it.', 'superseded')
  if (e.status !== 'available') throw new HttpError(403, 'This download is no longer available.', 'not_available')
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * Step 1, "prepare": checks ownership and eligibility, confirms the file can be
 * read, and issues a single use delivery token. Nothing is consumed here.
 */
export async function prepareDownload(user: SessionUser, entitlementId: string, meta: { ip?: string; ua?: string } = {}) {
  await rateLimit(`prepare:${user.id}`, 10, 60)
  const e = await loadEntitlement(entitlementId)
  try {
    assertRedeemable(e, user)
  } catch (err) {
    if (e && e.user_id === user.id) await logEvent({ entitlementId, userId: user.id, versionId: e.version_id, event: 'blocked', detail: (err as Error).message, ...meta })
    throw err
  }
  try {
    const size = await storage().size(e.storage_key)
    if (!size) throw new Error('File is empty')
  } catch (err) {
    await logEvent({ entitlementId, userId: user.id, versionId: e.version_id, event: 'prepare_failed', detail: (err as Error).message, ...meta })
    throw new HttpError(503, 'We could not prepare your file right now. Your download has not been used. Please try again later, or report a download problem.', 'prepare_failed')
  }
  const token = randomBytes(32).toString('base64url')
  // Only the newest token for an entitlement stays valid.
  await q(`update download_tokens set expires_at = now() where entitlement_id = $1 and used_at is null and expires_at > now()`, [entitlementId])
  await q(`insert into download_tokens (token_hash, entitlement_id, user_id, expires_at, ip, user_agent) values ($1,$2,$3, now() + make_interval(secs => $4), $5, $6)`, [hashToken(token), entitlementId, user.id, config.downloads.tokenTtlSeconds, meta.ip ?? null, meta.ua ?? null])
  await logEvent({ entitlementId, userId: user.id, versionId: e.version_id, event: 'prepared', ...meta })
  return { url: `/api/downloads/deliver/${token}`, expiresInSeconds: config.downloads.tokenTtlSeconds }
}

/**
 * Step 2, "deliver": opens the private file first, then consumes the token and
 * the entitlement in one transaction with conditional updates, so two
 * simultaneous requests can never both succeed.
 */
export async function startDelivery(user: SessionUser, token: string, meta: { ip?: string; ua?: string } = {}) {
  await rateLimit(`deliver:${user.id}`, 20, 60)
  const row = await one<{ id: string; entitlement_id: string; user_id: string; used_at: string | null; expired: boolean }>(
    `select id, entitlement_id, user_id, used_at, expires_at <= now() as expired from download_tokens where token_hash = $1`,
    [hashToken(token)],
  )
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'This download link is not valid. Start the download again from My Downloads.', 'bad_token')
  if (row.used_at) {
    await logEvent({ entitlementId: row.entitlement_id, userId: user.id, event: 'token_reused', ...meta })
    throw new HttpError(410, 'This download link has already been used.', 'token_used')
  }
  if (row.expired) throw new HttpError(410, 'This download link has expired. Start the download again from My Downloads. Your download has not been used.', 'token_expired')

  const e = await loadEntitlement(row.entitlement_id)
  assertRedeemable(e, user)

  // Open the file before consuming anything.
  let opened
  try {
    opened = await storage().open(e.storage_key)
  } catch (err) {
    await logEvent({ entitlementId: e.id, userId: user.id, versionId: e.version_id, event: 'prepare_failed', detail: (err as Error).message, ...meta })
    throw new HttpError(503, 'We could not prepare your file right now. Your download has not been used. Please try again later, or report a download problem.', 'prepare_failed')
  }

  try {
    await tx(async (client) => {
      const used = await q(`update download_tokens set used_at = now() where id = $1 and used_at is null and expires_at > now() returning id`, [row.id], client)
      if (!used.length) throw new HttpError(410, 'This download link has already been used.', 'token_used')
      const redeemed = await q(
        `update entitlements e set status = 'redeemed', redeemed_at = now(), status_changed_at = now()
          where e.id = $1 and e.user_id = $2 and e.status = 'available'
            and exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                         where oi.id = e.order_item_id and o.user_id = $2 and ${eligibleItemCondition})
          returning e.id`,
        [e.id, user.id],
        client,
      )
      if (!redeemed.length) throw conflict('This download has already been used.', 'already_used')
      await logEvent({ entitlementId: e.id, userId: user.id, versionId: e.version_id, event: 'delivery_started', ...meta }, client)
    })
  } catch (err) {
    opened.stream.destroy()
    throw err
  }

  return {
    stream: opened.stream,
    size: opened.size,
    fileName: e.file_name,
    contentType: e.content_type,
    onFinished: (ok: boolean, detail = '') =>
      logEvent({ entitlementId: e.id, userId: user.id, versionId: e.version_id, event: ok ? 'delivery_completed' : 'delivery_interrupted', detail, ...meta }).catch(() => {}),
  }
}

export async function reportProblem(user: SessionUser, entitlementId: string, message: string) {
  await rateLimit(`report:${user.id}`, 5, 3600)
  const e = await one<{ id: string; user_id: string }>('select id, user_id from entitlements where id = $1', [entitlementId])
  if (!e || e.user_id !== user.id) throw notFound('Download')
  const open = await one('select 1 from download_problem_reports where entitlement_id = $1 and status = $2', [entitlementId, 'open'])
  if (open) throw conflict('You already reported a problem with this download. We will be in touch.')
  return one<{ id: string }>(`insert into download_problem_reports (entitlement_id, user_id, message) values ($1,$2,$3) returning id`, [entitlementId, user.id, message])
}

/**
 * Admin exception for genuine delivery problems: grants ONE new download of the
 * latest version for a purchase. Requires a reason and is always audited.
 */
export async function grantReplacement(actor: SessionUser, orderItemId: string, reason: string, reportId: string | null, ip?: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('Please give a reason for the replacement download (at least 5 characters).')
  return tx(async (client) => {
    const item = await one<{ id: string; user_id: string; product_id: string; version_id: string | null; title: string; order_number: string }>(
      `select oi.id, o.user_id, oi.product_id, p.current_version_id as version_id, oi.title_snapshot as title, o.order_number
         from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
        where oi.id = $1 and ${eligibleItemCondition} and o.user_id is not null for update of oi`,
      [orderItemId],
      client,
    )
    if (!item) throw badRequest('This purchase is not eligible for downloads (unpaid, refunded or not a digital product).')
    if (!item.version_id) throw badRequest('No file has been released for this product yet.')
    const available = await one('select 1 from entitlements where order_item_id = $1 and status = $2', [orderItemId, 'available'], client)
    if (available) throw conflict('The customer already has an unused download for this purchase.')
    const ent = await one<{ id: string }>(
      `insert into entitlements (user_id, product_id, order_item_id, version_id, source, reason, granted_by) values ($1,$2,$3,$4,'admin_replacement',$5,$6) returning id`,
      [item.user_id, item.product_id, item.id, item.version_id, reason.trim(), actor.email],
      client,
    )
    if (reportId) {
      await q(`update download_problem_reports set status = 'resolved', resolution_note = $2, resolved_by = $3, resolved_at = now() where id = $1`, [reportId, `Replacement download granted: ${reason.trim()}`, actor.email], client)
    }
    await audit({ actor, action: 'download.replacement_granted', entityType: 'order_item', entityId: item.id, summary: `Granted a replacement download of ${item.title} (order ${item.order_number}). Reason: ${reason.trim()}`, data: { entitlementId: ent!.id, reportId }, ip }, client)
    return ent
  })
}

export type RefundDownloadPolicy = 'revoke_unredeemed' | 'keep'

/** Applies the refund policy to unused downloads of refunded lines. */
export async function applyRefundToEntitlements(orderId: string, policy: RefundDownloadPolicy, client: PoolClient) {
  if (policy !== 'revoke_unredeemed') return 0
  const rows = await q(
    `update entitlements e set status = 'revoked', status_changed_at = now(), reason = 'Order line refunded'
      from order_items oi where oi.id = e.order_item_id and oi.order_id = $1 and oi.refunded_quantity >= oi.quantity and e.status = 'available'
      returning e.id`,
    [orderId],
    client,
  )
  return rows.length
}

export interface DownloadCard {
  orderItemId: string
  entitlementId: string | null
  productId: string
  productSlug: string
  title: string
  orderNumber: string
  orderId: string
  purchasedAt: string
  versionNumber: number | null
  versionReleasedAt: string | null
  versionNotes: string
  status: 'available' | 'update_available' | 'replacement_available' | 'used' | 'awaiting_file' | 'unavailable'
  statusText: string
  redeemedAt: string | null
  canReport: boolean
}

/** Everything the customer's My Downloads page shows. Read only: never grants or consumes. */
export async function listDownloads(userId: string): Promise<DownloadCard[]> {
  const items = await q<{ order_item_id: string; product_id: string; slug: string; title: string; order_number: string; order_id: string; paid_at: string; order_status: string; refunded: boolean }>(
    `select oi.id as order_item_id, oi.product_id, p.slug, oi.title_snapshot as title, o.order_number, o.id as order_id, coalesce(o.paid_at, o.created_at) as paid_at,
            o.status as order_status, (oi.refunded_quantity >= oi.quantity) as refunded
       from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
      where o.user_id = $1 and oi.product_type = 'digital' and o.status in ('paid','partially_refunded','refunded','disputed')
      order by coalesce(o.paid_at, o.created_at) desc`,
    [userId],
  )
  const ents = await q<{ id: string; order_item_id: string; status: string; source: string; redeemed_at: string | null; version_number: number; released_at: string; notes: string; granted_at: string }>(
    `select e.id, e.order_item_id, e.status, e.source, e.redeemed_at, v.version_number, v.released_at, v.notes, e.granted_at
       from entitlements e join product_versions v on v.id = e.version_id
      where e.user_id = $1 order by e.granted_at desc`,
    [userId],
  )
  return items.map((it) => {
    const mine = ents.filter((e) => e.order_item_id === it.order_item_id)
    const available = mine.find((e) => e.status === 'available')
    const latest = available ?? mine.find((e) => e.status === 'redeemed') ?? mine[0]
    const base = {
      orderItemId: it.order_item_id,
      productId: it.product_id,
      productSlug: it.slug,
      title: it.title,
      orderNumber: it.order_number,
      orderId: it.order_id,
      purchasedAt: it.paid_at,
      entitlementId: latest?.id ?? null,
      versionNumber: latest?.version_number ?? null,
      versionReleasedAt: latest?.released_at ?? null,
      versionNotes: latest?.notes ?? '',
      redeemedAt: latest?.redeemed_at ?? null,
      canReport: Boolean(latest && latest.status === 'redeemed'),
    }
    if (it.refunded || !['paid', 'partially_refunded'].includes(it.order_status)) {
      return { ...base, status: 'unavailable' as const, statusText: it.order_status === 'disputed' ? 'Unavailable while the payment is under review' : 'Not available (refunded)', canReport: false }
    }
    if (!latest) return { ...base, status: 'awaiting_file' as const, statusText: 'Your file is being prepared. It will appear here when it is ready.' }
    if (available) {
      if (available.source === 'update') return { ...base, status: 'update_available' as const, statusText: 'Updated version available • 1 new download' }
      if (available.source === 'admin_replacement') return { ...base, status: 'replacement_available' as const, statusText: 'Replacement download available • 1 download' }
      return { ...base, status: 'available' as const, statusText: '1 download available' }
    }
    return { ...base, status: 'used' as const, statusText: 'Download used' }
  })
}
