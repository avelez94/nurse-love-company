/*
  Coupons: the owner creates and manages discount codes from the admin.

  Every code lives in Stripe (a coupon plus a promotion code), so checkout,
  which already accepts promotion codes, always uses the real terms. Nothing
  about a discount is stored only on this site.

  * Percent off (1 to 100) or a dollar amount off, applied once per order.
  * Optional end date, maximum number of uses, first order only and minimum
    order. Stripe enforces all of these at checkout.
  * Optional start date. Stripe has no start date, so a code that starts later
    is created switched off with its start time in its metadata, and the hourly
    maintenance job switches it on when the time comes.
  * Turning a code off is immediate. A code turned off by hand is never
    switched back on by the schedule.
*/
import type { SessionUser } from '../auth.js'
import { audit } from '../lib/audit.js'
import { badRequest, HttpError } from '../lib/errors.js'
import { stripe, type Stripe } from '../lib/stripe.js'
import { bool, int, isoDate, oneOf, str } from '../lib/validate.js'
import { recheckCoupons } from './marketing.js'

export const CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/
const START_KEY = 'nlc_starts_at'

export type CouponStatus = 'active' | 'scheduled' | 'expired' | 'used_up' | 'off'

export interface CouponView {
  id: string
  code: string
  status: CouponStatus
  percentOff: number | null
  amountOffCents: number | null
  startsAt: string | null
  endsAt: string | null
  maxUses: number | null
  timesUsed: number
  firstOrderOnly: boolean
  minimumCents: number | null
  note: string
  createdAt: string
}

/** Turns Stripe errors into messages the owner can act on. */
function stripeProblem(err: unknown): never {
  if (err instanceof HttpError) throw err
  const e = err as { type?: string; message?: string; statusCode?: number }
  if (e.type === 'StripePermissionError' || e.statusCode === 403) {
    throw new HttpError(
      503,
      "Stripe did not allow this. In Stripe, open Developers, then API keys, edit the store's restricted key, set Coupons and Promotion codes to Write, and save. Then try again.",
      'stripe_permission',
    )
  }
  if (e.type === 'StripeInvalidRequestError' && e.message) {
    if (/already exists/i.test(e.message)) throw badRequest('That code already exists in Stripe. Pick a different code.')
    throw badRequest(`Stripe could not save this: ${e.message}`)
  }
  throw err
}

const toIso = (seconds: number | null | undefined) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null)

export function couponView(pc: Stripe.PromotionCode, now = Date.now()): CouponView {
  const coupon = typeof pc.promotion.coupon === 'object' && pc.promotion.coupon ? pc.promotion.coupon : null
  const ends = [pc.expires_at, coupon?.redeem_by].filter((x): x is number => typeof x === 'number')
  const endsAt = ends.length ? Math.min(...ends) * 1000 : null
  const startRaw = pc.metadata?.[START_KEY] || ''
  const startsAt = startRaw && !Number.isNaN(Date.parse(startRaw)) ? new Date(startRaw).toISOString() : null
  const used = pc.times_redeemed ?? 0
  let status: CouponStatus
  if (endsAt !== null && endsAt <= now) status = 'expired'
  else if (pc.max_redemptions && used >= pc.max_redemptions) status = 'used_up'
  else if (pc.active && coupon?.valid !== false) status = 'active'
  else if (!pc.active && startsAt && Date.parse(startsAt) > now) status = 'scheduled'
  else status = coupon && coupon.valid === false ? 'expired' : 'off'
  return {
    id: pc.id,
    code: pc.code,
    status,
    percentOff: coupon?.percent_off ?? null,
    amountOffCents: coupon?.amount_off ?? null,
    startsAt,
    endsAt: endsAt === null ? null : new Date(endsAt).toISOString(),
    maxUses: pc.max_redemptions ?? null,
    timesUsed: used,
    firstOrderOnly: Boolean(pc.restrictions?.first_time_transaction),
    minimumCents: pc.restrictions?.minimum_amount ?? null,
    note: pc.metadata?.nlc_note ?? '',
    createdAt: toIso(pc.created) ?? new Date(0).toISOString(),
  }
}

/** Every promotion code in Stripe, newest first, with its usage and status. */
export async function listCoupons() {
  const s = stripe()
  const codes: Stripe.PromotionCode[] = []
  try {
    let starting_after: string | undefined
    // Up to 500 codes, which is far more than a small store keeps.
    for (let page = 0; page < 5; page++) {
      const res = await s.promotionCodes.list({ limit: 100, expand: ['data.promotion.coupon'], ...(starting_after ? { starting_after } : {}) })
      codes.push(...res.data)
      if (!res.has_more || !res.data.length) break
      starting_after = res.data[res.data.length - 1].id
    }
  } catch (err) {
    stripeProblem(err)
  }
  const now = Date.now()
  return { coupons: codes.map((pc) => couponView(pc, now)) }
}

function validate(body: Record<string, unknown>, now = Date.now()) {
  const code = str(body.code, 'Code', { min: 2, max: 40 }).toUpperCase()
  if (!CODE_PATTERN.test(code)) throw badRequest('Codes use letters, numbers, underscores or hyphens only, with no spaces, 2 to 40 characters.')
  const kind = oneOf(body.kind, 'Discount type', ['percent', 'amount'] as const)
  let percentOff: number | null = null
  let amountOffCents: number | null = null
  if (kind === 'percent') {
    percentOff = int(body.percent_off, 'Percent off', { min: 1, max: 100 })
  } else {
    amountOffCents = int(body.amount_off_cents, 'Amount off', { min: 1, max: 1_000_000 })
  }
  const startsAt = body.starts_at ? isoDate(body.starts_at, 'Start date') : null
  const endsAt = body.ends_at ? isoDate(body.ends_at, 'End date') : null
  if (endsAt && endsAt.getTime() <= now) throw badRequest('The end date has already passed.')
  if (endsAt && endsAt.getTime() > now + 5 * 365 * 86400000) throw badRequest('The end date can be up to five years away.')
  if (startsAt && endsAt && startsAt >= endsAt) throw badRequest('The start date must be before the end date.')
  const maxUses = int(body.max_uses, 'Maximum uses', { min: 1, max: 1_000_000, optional: true })
  const minimumCents = int(body.minimum_cents, 'Minimum order', { min: 1, max: 100_000_000, optional: true })
  if (amountOffCents && minimumCents && minimumCents < amountOffCents) throw badRequest('The minimum order must be at least the amount off.')
  return {
    code,
    percentOff,
    amountOffCents,
    startsAt: startsAt && startsAt.getTime() > now ? startsAt : null,
    endsAt,
    maxUses,
    firstOrderOnly: bool(body.first_order_only),
    minimumCents,
    note: str(body.note, 'Note', { max: 200, optional: true }),
  }
}

/** Creates the coupon and its promotion code in Stripe. */
export async function createCoupon(actor: SessionUser, body: Record<string, unknown>, ip?: string) {
  const v = validate(body)
  const s = stripe()
  let coupon: Stripe.Coupon
  try {
    coupon = await s.coupons.create({
      name: v.code,
      duration: 'once',
      ...(v.percentOff ? { percent_off: v.percentOff } : { amount_off: v.amountOffCents!, currency: 'usd' }),
      metadata: { created_in: 'nurse_love_admin' },
    })
  } catch (err) {
    stripeProblem(err)
  }
  let pc: Stripe.PromotionCode
  try {
    pc = await s.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: v.code,
      active: !v.startsAt,
      ...(v.endsAt ? { expires_at: Math.floor(v.endsAt.getTime() / 1000) } : {}),
      ...(v.maxUses ? { max_redemptions: v.maxUses } : {}),
      restrictions: {
        first_time_transaction: v.firstOrderOnly,
        ...(v.minimumCents ? { minimum_amount: v.minimumCents, minimum_amount_currency: 'usd' } : {}),
      },
      metadata: { [START_KEY]: v.startsAt ? v.startsAt.toISOString() : '', nlc_note: v.note, created_in: 'nurse_love_admin' },
    })
  } catch (err) {
    // Do not leave an unused coupon behind in Stripe.
    await s.coupons.del(coupon.id).catch(() => undefined)
    stripeProblem(err)
  }
  pc.promotion.coupon = coupon
  const view = couponView(pc)
  await audit({ actor, action: 'coupon.created', entityType: 'coupon', entityId: pc.id, summary: `Created coupon code ${v.code}`, data: { ...view }, ip })
  return { coupon: view }
}

/** Turns a code off (immediately) or back on. */
export async function setCouponActive(actor: SessionUser, id: string, active: boolean, ip?: string) {
  if (!/^promo_[A-Za-z0-9]+$/.test(id)) throw badRequest('Invalid coupon.')
  let pc: Stripe.PromotionCode
  try {
    pc = await stripe().promotionCodes.update(id, { active, metadata: { [START_KEY]: '' }, expand: ['promotion.coupon'] })
  } catch (err) {
    stripeProblem(err)
  }
  await audit({ actor, action: active ? 'coupon.turned_on' : 'coupon.turned_off', entityType: 'coupon', entityId: id, summary: `Turned ${active ? 'on' : 'off'} coupon code ${pc.code}`, ip })
  // A banner showing a code that was just turned off stops showing now.
  if (!active) await recheckCoupons().catch(() => undefined)
  return { coupon: couponView(pc) }
}

/** Scheduled job: switches on codes whose start time has arrived. */
export async function startScheduledCoupons(now = Date.now()) {
  let s: Stripe
  try {
    s = stripe()
  } catch {
    return 0
  }
  let started = 0
  const res = await s.promotionCodes.list({ active: false, limit: 100 })
  for (const pc of res.data) {
    const at = Date.parse(pc.metadata?.[START_KEY] || '')
    if (Number.isNaN(at) || at > now) continue
    if (pc.expires_at && pc.expires_at * 1000 <= now) continue
    await s.promotionCodes.update(pc.id, { active: true, metadata: { [START_KEY]: '' } })
    await audit({ actor: null, action: 'coupon.started', entityType: 'coupon', entityId: pc.id, summary: `Coupon code ${pc.code} started on its scheduled date` })
    started++
  }
  return started
}
