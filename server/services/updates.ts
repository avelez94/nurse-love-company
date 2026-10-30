/*
  Automatic product updates.

  Saving an existing, published digital product with a new file releases it:
  the save and the release happen in one transaction, so if validation,
  storage or the save fails, the previous version stays current and nothing
  is granted or queued. Uploading alone releases nothing. Saving the same
  content again (compared by SHA-256, not file name), saving a draft, and the
  first file of a product never notify anyone.

  Notifications go only to customers who downloaded an older version and
  still have an eligible purchase: one per customer, product and version.
  They are rows in update_notifications, claimed by one worker at a time,
  rechecked right before sending (skipped if the customer already downloaded
  the latest version or is no longer eligible) and handed to the email
  outbox with a stable idempotency key. Without Resend they are held, never
  dropped, until the owner retries them.
*/
import { waitUntil } from '@vercel/functions'
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { emailSendingConfigured, kickDispatcher, queueEmail } from '../email/outbox.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { str, uuid } from '../lib/validate.js'
import { releaseInTx } from './entitlements.js'
import { updateProduct } from './products.js'
import { getSettings } from './settings.js'

export type FileOutcome = 'released' | 'first_file' | 'identical' | 'kept_for_draft' | 'already_released'

/** The normal product Save. With a staged replacement file, an existing published product is updated automatically. */
export async function saveProduct(actor: SessionUser, id: string, body: Record<string, unknown>, ip?: string) {
  const uploadId = body.replacement_upload_id ? uuid(body.replacement_upload_id, 'replacement file') : null
  const notes = str(body.update_notes, 'What changed', { optional: true, max: 2000 })
  const result = await tx(async (client) => {
    await updateProduct(actor, id, body, ip, client)
    if (!uploadId) return { file: null }
    const p = await one<{ type: string; status: string; archived_at: string | null; current_version_id: string | null }>('select type, status, archived_at, current_version_id from products where id = $1', [id], client)
    if (p!.type !== 'digital') throw badRequest('Only digital products have downloadable files.')
    const up = await one<{ product_id: string; sha256: string; released_version_id: string | null }>('select product_id, sha256, released_version_id from product_file_uploads where id = $1 for update', [uploadId], client)
    if (!up || up.product_id !== id) throw notFound('Uploaded file')
    // A retried save (double click, network retry) finds the file already released and changes nothing.
    if (up.released_version_id) return { file: { outcome: 'already_released' as FileOutcome } }
    const cur = p!.current_version_id ? await one<{ sha256: string; version_number: number }>('select sha256, version_number from product_versions where id = $1', [p!.current_version_id], client) : null
    if (cur && cur.sha256 === up.sha256) {
      await q(`update product_file_uploads set outcome = 'identical' where id = $1`, [uploadId], client)
      return { file: { outcome: 'identical' as FileOutcome, versionNumber: cur.version_number } }
    }
    // A draft or archived product with a file already keeps the new file staged: no new downloads, no emails.
    if (cur && (p!.status !== 'published' || p!.archived_at)) return { file: { outcome: 'kept_for_draft' as FileOutcome } }
    const rel = await releaseInTx(client, { productId: id, uploadId, notes, notify: Boolean(cur), idempotencyKey: `save:${uploadId}`, trigger: 'save', actor, ip })
    return { file: { outcome: (cur ? 'released' : 'first_file') as FileOutcome, versionNumber: rel.versionNumber, releaseId: rel.id, granted: rel.granted_count, notifications: rel.notifications } }
  })
  if (result.file && 'notifications' in result.file && result.file.notifications) kickUpdateNotifications()
  return { ok: true, ...result, emailConfigured: emailSendingConfigured() }
}

/* ---------- Sending ---------- */

interface NoticeRow {
  id: string
  release_id: string
  product_id: string
  version_id: string
  user_id: string
  attempts: number
}

const eligiblePurchase = `exists (select 1 from order_items oi join orders o on o.id = oi.order_id
  where o.user_id = $1 and oi.product_id = $2 and oi.product_type = 'digital' and o.status in ('paid','partially_refunded') and oi.refunded_quantity < oi.quantity and not o.is_demo)`

async function processNotice(n: NoticeRow, configured: boolean, timeZone: string) {
  await tx(async (client) => {
    const set = (status: string, reason: string, emailId: string | null = null) =>
      q(`update update_notifications set status = $2, status_reason = $3, email_id = coalesce($4, email_id), sent_at = case when $2 = 'sent' then now() else sent_at end, claimed_at = null, updated_at = now() where id = $1`, [n.id, status, reason, emailId], client)
    if (!configured) return set('held', 'Email sending is not connected (Resend). Nothing was sent. Use "Retry notifications" once it is connected.')
    const c = await one<{ email: string; name: string; pref: boolean | null; suppressed: boolean; current: string | null; title: string; version_number: number; released_at: string; notes: string; eligible: boolean; got_latest: boolean; has_latest: boolean }>(
      `select u.email, u.name, cp.product_updates as pref, exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed,
              p.current_version_id as current, p.title, v.version_number, v.released_at, v.notes, ${eligiblePurchase} as eligible,
              exists (select 1 from entitlements e where e.user_id = $1 and e.version_id = $3 and e.status = 'redeemed') as got_latest,
              exists (select 1 from entitlements e where e.user_id = $1 and e.version_id = $3 and e.status = 'available') as has_latest
         from "user" u join products p on p.id = $2 join product_versions v on v.id = $3 left join customer_profiles cp on cp.user_id = u.id where u.id = $1`,
      [n.user_id, n.product_id, n.version_id],
      client,
    )
    if (!c) return set('skipped', 'The customer account no longer exists.')
    if (c.current !== n.version_id) return set('canceled', 'A newer version replaced this one before it was sent.')
    if (!c.eligible) return set('skipped', 'No eligible purchase any more (refunded, disputed or canceled).')
    if (c.got_latest) return set('skipped', 'Already downloaded the latest version.')
    if (!c.has_latest) return set('skipped', 'No download of the latest version is available.')
    if (c.pref === false) return set('skipped', 'The customer turned off product update emails.')
    if (c.suppressed) return set('skipped', 'The email address is suppressed after a bounce or complaint.')
    const emailId = await queueEmail(
      {
        type: 'product_update',
        to: c.email,
        userId: n.user_id,
        releaseId: n.release_id,
        vars: {
          name: c.name.trim().split(/\s+/)[0] || 'there',
          product_title: c.title,
          version: String(c.version_number),
          release_date: new Date(c.released_at).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: timeZone || 'UTC' }),
          update_notes: c.notes ? `What changed: ${c.notes}` : '',
        },
        footerNote: 'Each update includes one download. Opening this email, signing in or looking at My downloads never uses it; only pressing Download does.',
        idempotencyKey: `update_notice:${n.user_id}:${n.product_id}:${n.version_id}`,
      },
      client,
    )
    return set('sent', '', emailId)
  })
}

/** Sends pending update notifications. Safe to run concurrently: each row is claimed by one run. */
export async function runUpdateNotifications(max = 500) {
  await q(`update update_notifications set status = 'scheduled', claimed_at = null, updated_at = now() where status = 'processing' and claimed_at < now() - interval '10 minutes'`)
  const configured = emailSendingConfigured()
  const timeZone = (await getSettings()).store.timezone
  let handled = 0
  while (handled < max) {
    const rows = await q<NoticeRow>(
      `update update_notifications set status = 'processing', claimed_at = now(), attempts = attempts + 1, updated_at = now()
        where id in (select id from update_notifications where status = 'scheduled' order by created_at for update skip locked limit 50)
        returning id, release_id, product_id, version_id, user_id, attempts`,
    )
    if (!rows.length) break
    handled += rows.length
    for (const n of rows) {
      try {
        await processNotice(n, configured, timeZone)
      } catch (err) {
        await q(
          `update update_notifications set status = case when attempts >= 5 then 'failed' else 'scheduled' end, last_error = $2, claimed_at = null,
                  status_reason = case when attempts >= 5 then 'Could not be prepared after five tries.' else status_reason end, updated_at = now()
            where id = $1 and status = 'processing'`,
          [n.id, (err as Error).message.slice(0, 500)],
        )
      }
    }
  }
  if (handled) kickDispatcher()
  return handled
}

let running: Promise<unknown> | null = null
/** Sends right after a save, without holding up the response. The hourly job picks up anything left. */
export function kickUpdateNotifications() {
  if (running) return
  running = (async () => {
    await new Promise((r) => setImmediate(r))
    try {
      await runUpdateNotifications()
    } catch (err) {
      console.error('[updates] notification error', err)
    } finally {
      running = null
    }
  })()
  waitUntil(running)
}

/* ---------- Admin visibility ---------- */

/** What happened to each release's emails. "Sent" means Resend accepted it; queued, skipped, held and failed are counted separately. */
export async function releaseStatuses(productId: string) {
  const rows = await q<{ release_id: string; display: string; n: number }>(
    `select n.release_id,
            case when n.status in ('scheduled','processing') then 'queued'
                 when n.status = 'sent' and e.status in ('queued','sending') then 'queued'
                 when n.status = 'sent' and e.status in ('sent','delivered','delivery_delayed') then 'sent'
                 when n.status = 'sent' and e.status = 'suppressed' then 'skipped'
                 when n.status = 'sent' and e.status = 'not_configured' then 'held'
                 when n.status = 'sent' then 'failed'
                 else n.status end as display,
            count(*)::int as n
       from update_notifications n left join emails e on e.id = n.email_id where n.product_id = $1 group by 1, 2`,
    [productId],
  )
  const out: Record<string, Record<string, number>> = {}
  for (const r of rows) (out[r.release_id] ??= { queued: 0, sent: 0, skipped: 0, held: 0, failed: 0, canceled: 0 })[r.display] = r.n
  return out
}

export async function releaseNotifications(productId: string, releaseId: string) {
  return q(
    `select n.id, n.status, n.status_reason, n.attempts, n.sent_at, n.created_at, n.email_id, e.status as email_status, e.failure_reason as email_failure, u.email as customer_email, u.id as user_id
       from update_notifications n left join emails e on e.id = n.email_id left join "user" u on u.id = n.user_id
      where n.product_id = $1 and n.release_id = $2 order by n.created_at`,
    [productId, releaseId],
  )
}

/** Controlled retry: held (email not connected) and failed notifications for a release are tried again. */
export async function retryReleaseNotifications(actor: SessionUser, productId: string, releaseId: string, ip?: string) {
  if (!emailSendingConfigured()) throw badRequest('Email sending (Resend) is not connected yet, so nothing can be sent. The notifications are kept.')
  const rel = await one<{ version_id: string }>('select version_id from product_releases where id = $1 and product_id = $2', [releaseId, productId])
  if (!rel) throw notFound('Release')
  const notices = await q(`update update_notifications set status = 'scheduled', status_reason = '', attempts = 0, updated_at = now() where release_id = $1 and status in ('held','failed') returning id`, [releaseId])
  const emails = await q(
    `update emails set status = 'queued', failure_reason = '', attempts = 0 where id in (select email_id from update_notifications where release_id = $1 and status = 'sent' and email_id is not null) and status in ('failed','not_configured') returning id`,
    [releaseId],
  )
  await audit({ actor, action: 'product.update_notifications_retried', entityType: 'product', entityId: productId, summary: `Retried ${notices.length + emails.length} update notifications`, data: { releaseId }, ip })
  kickUpdateNotifications()
  kickDispatcher()
  return { count: notices.length + emails.length }
}
