/*
  Verified purchase reviews.

  Who can review: a signed in customer with a paid purchase of the product
  (a free Freebie Corner claim does not count) that is not fully refunded (order paid or partially refunded, and that
  line not fully refunded). Checked on the server on every write.

  One review per customer per product (database unique key). Writing again
  edits the same review. New and edited reviews wait for the owner's
  approval before they are public.

  Refunds: if the purchase is later fully refunded, the existing review is
  NOT removed (criticism is never hidden for that reason), but it loses the
  "Verified purchase" label and can no longer be edited. "Verified" is
  computed live from the orders every time, never stored.

  Privacy: the public sees only the display name the customer chose, the
  rating, title, text, date and the owner's reply. Never an email, billing
  name, order number or anything else from the purchase.

  Ratings: averages and counts use published reviews only.
*/
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, HttpError, notFound } from '../lib/errors.js'
import { int, oneOf, str } from '../lib/validate.js'

const ELIGIBLE = `exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                   where o.user_id = r.user_id and oi.product_id = r.product_id
                     and o.status in ('paid','partially_refunded') and oi.refunded_quantity < oi.quantity and not oi.is_freebie)`

export async function isEligible(userId: string, productId: string) {
  return Boolean(
    await one(
      `select 1 from order_items oi join orders o on o.id = oi.order_id
        where o.user_id = $1 and oi.product_id = $2 and o.status in ('paid','partially_refunded') and oi.refunded_quantity < oi.quantity and not oi.is_freebie`,
      [userId, productId],
    ),
  )
}

function clean(v: unknown, field: string, min: number, max: number) {
  return str(v, field, { min, max })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The customer's own review of a product, and whether they may write or edit one. */
export async function myReview(user: SessionUser, productId: string) {
  const review = await one(`select id, rating, title, body, display_name, status, moderation_reason, owner_reply, updated_at from reviews where user_id = $1 and product_id = $2`, [user.id, productId])
  return { eligible: await isEligible(user.id, productId), review }
}

/** Purchases the customer can review, for "Leave a review" in the account area. */
export async function reviewablePurchases(user: SessionUser) {
  return q(
    `select p.id as product_id, p.slug, p.title, r.id as review_id, r.status as review_status, r.rating
       from products p left join reviews r on r.product_id = p.id and r.user_id = $1
      where exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                     where o.user_id = $1 and oi.product_id = p.id and o.status in ('paid','partially_refunded') and oi.refunded_quantity < oi.quantity and not oi.is_freebie)
      order by p.title`,
    [user.id],
  )
}

/** Create or edit the customer's single review of a product. Always returns to pending for the owner to check. */
export async function saveReview(user: SessionUser, productId: string, b: Record<string, unknown>) {
  if (!(await isEligible(user.id, productId))) {
    throw new HttpError(403, 'Reviews can be written for products you bought (and that were not refunded).', 'not_eligible')
  }
  const rating = int(b.rating, 'Rating', { min: 1, max: 5 })!
  const title = clean(b.title, 'Review title', 2, 100)
  const body = clean(b.body, 'Review', 10, 2000)
  const displayName = clean(b.display_name, 'Public display name', 2, 40)
  if (/@|\d{5,}/.test(displayName)) throw badRequest('Please choose a display name without an email address or long numbers.')
  const row = await one<{ id: string; created: boolean }>(
    `insert into reviews (product_id, user_id, rating, title, body, display_name) values ($1,$2,$3,$4,$5,$6)
     on conflict (user_id, product_id) do update set rating = excluded.rating, title = excluded.title, body = excluded.body,
       display_name = excluded.display_name, status = 'pending', moderation_reason = '', updated_at = now()
     returning id, (xmax = 0) as created`,
    [productId, user.id, rating, title, body, displayName],
  )
  return { id: row!.id, status: 'pending' as const, created: row!.created }
}

/** Public reviews for a product page: published only, with live verification and no private details. */
export async function productReviews(productId: string) {
  const reviews = await q<{ id: string; rating: number; title: string; body: string; display_name: string; created_at: string; updated_at: string; owner_reply: string; owner_reply_at: string | null; verified: boolean }>(
    `select r.id, r.rating, r.title, r.body, r.display_name, r.created_at, r.updated_at, r.owner_reply, r.owner_reply_at, ${ELIGIBLE} as verified
       from reviews r where r.product_id = $1 and r.status = 'published' order by r.created_at desc limit 100`,
    [productId],
  )
  const summary = await one<{ count: number; average: number | null }>(`select count(*)::int as count, round(avg(rating)::numeric, 1)::float as average from reviews where product_id = $1 and status = 'published'`, [productId])
  return {
    count: summary?.count ?? 0,
    average: summary?.average ?? null,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      displayName: r.display_name,
      date: r.created_at,
      verified: r.verified,
      ownerReply: r.owner_reply || null,
      ownerReplyDate: r.owner_reply ? r.owner_reply_at : null,
    })),
  }
}

export const REPORT_REASONS = ['spam', 'abuse', 'private_information', 'not_about_product', 'other'] as const

/** Anyone can flag a published review. It stays visible; the owner decides. */
export async function reportReview(id: string, reason: (typeof REPORT_REASONS)[number]) {
  const r = await one(
    `update reviews set report_count = report_count + 1, reported_at = now(),
       report_reasons = case when $2 = any(report_reasons) then report_reasons else array_append(report_reasons, $2) end
     where id = $1 and status = 'published' returning id`,
    [id, reason],
  )
  if (!r) throw notFound('Review')
}

/* ---------- Admin ---------- */

export async function adminReviews(filter: { status?: string; productId?: string; rating?: number }) {
  const where: string[] = ['true']
  const params: unknown[] = []
  if (filter.status === 'reported') where.push('r.report_count > 0')
  else if (filter.status) {
    params.push(filter.status)
    where.push(`r.status = $${params.length}`)
  }
  if (filter.productId) {
    params.push(filter.productId)
    where.push(`r.product_id = $${params.length}`)
  }
  if (filter.rating) {
    params.push(filter.rating)
    where.push(`r.rating = $${params.length}`)
  }
  const rows = await q(
    `select r.*, p.title as product_title, p.slug as product_slug, ${ELIGIBLE} as verified
       from reviews r join products p on p.id = r.product_id where ${where.join(' and ')}
      order by (r.status = 'pending') desc, r.report_count desc, r.updated_at desc limit 300`,
    params,
  )
  const counts = await one(
    `select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'published')::int as published,
            count(*) filter (where status = 'rejected')::int as rejected, count(*) filter (where report_count > 0)::int as reported from reviews`,
  )
  return { reviews: rows, counts }
}

export async function moderateReview(actor: SessionUser, id: string, b: Record<string, unknown>, ip?: string) {
  const action = oneOf(b.action, 'Action', ['publish', 'unpublish', 'reject', 'clear_reports', 'reply', 'remove_reply'] as const)
  const r = await one<{ title: string; status: string }>('select title, status from reviews where id = $1', [id])
  if (!r) throw notFound('Review')
  if (action === 'publish') {
    await q(`update reviews set status = 'published', moderation_reason = '', moderated_by = $2, moderated_at = now() where id = $1`, [id, actor.email])
  } else if (action === 'unpublish' || action === 'reject') {
    const reason = oneOf(b.reason, 'Reason', ['spam', 'abuse', 'private_information', 'not_about_product', 'other'] as const)
    const note = str(b.note, 'Note', { optional: true, max: 300 })
    if (reason === 'other' && !note) throw badRequest('Please describe the reason.')
    await q(`update reviews set status = $2, moderation_reason = $3, moderated_by = $4, moderated_at = now() where id = $1`, [id, action === 'reject' ? 'rejected' : 'pending', note ? `${reason}: ${note}` : reason, actor.email])
  } else if (action === 'clear_reports') {
    await q(`update reviews set report_count = 0, report_reasons = '{}', reported_at = null where id = $1`, [id])
  } else if (action === 'reply') {
    const reply = clean(b.reply, 'Reply', 2, 1000)
    await q(`update reviews set owner_reply = $2, owner_reply_at = now() where id = $1`, [id, reply])
  } else {
    await q(`update reviews set owner_reply = '', owner_reply_at = null where id = $1`, [id])
  }
  const words: Record<string, string> = { publish: 'Published', unpublish: 'Unpublished', reject: 'Rejected', clear_reports: 'Cleared reports on', reply: 'Replied to', remove_reply: 'Removed the reply on' }
  await audit({ actor, action: `review.${action}`, entityType: 'review', entityId: id, summary: `${words[action]} review "${r.title}"${b.reason ? ` (${String(b.reason)})` : ''}`, ip })
}
