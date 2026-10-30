/*
  Marketing: owner managed banners and the Nurse Kin popup.

  Rules this file enforces:
  * Copy is plain text in fixed fields with preset themes and icons. No HTML.
  * Links are either an internal page (#shop) or an https address.
  * Only published, active banners inside their schedule are public. Each
    placement shows ONE banner: the lowest priority number wins, then the most
    recently published. Overlaps are reported to the admin as conflicts.
  * A banner never creates a discount. A coupon code is shown only after it
    was checked against a real, active Stripe promotion code, and the offer
    text is generated from Stripe's own terms. When that code expires or is
    switched off, the banner stops showing.
  * The Nurse Kin launcher stays hidden until it is published with a real https
    address, a launcher label, a headline, a description and a button label.
    Visitors open it themselves; it never opens automatically.
  * Statistics are daily aggregate counts with no visitor identifiers.
*/
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import { stripe, stripeAvailable } from '../lib/stripe.js'
import { bool, int, isoDate, oneOf, str } from '../lib/validate.js'

export const STYLES = ['announcement', 'strip', 'image'] as const
export const PLACEMENTS = ['top', 'below_hero', 'above_freebies'] as const
export const THEMES = ['blush', 'raspberry', 'ivory', 'sage'] as const
export const ICONS = ['none', 'heart', 'sparkles', 'gift', 'download', 'truck', 'star', 'tag'] as const
/** Public pages a banner or the popup can appear on. Sign in, checkout, accounts and admin are never included. */
export const PAGES = ['home', 'shop', 'collections', 'extra', 'freebies', 'tutorials', 'product', 'story', 'help'] as const
/** Fixed upload target for the single popup row (storage_uploads.target_id is a uuid). */
export const POPUP_UPLOAD_TARGET = '00000000-0000-0000-0000-00000000c0de'

export interface BannerRow {
  id: string
  name: string
  style: (typeof STYLES)[number]
  placement: (typeof PLACEMENTS)[number]
  headline: string
  body: string
  button_label: string
  link: string
  image_key: string | null
  image_type: string | null
  image_alt: string
  theme: (typeof THEMES)[number]
  icon: (typeof ICONS)[number]
  coupon_code: string
  coupon_offer: string
  coupon_expires_at: string | null
  coupon_checked_at: string | null
  active: boolean
  status: 'draft' | 'published' | 'archived'
  starts_at: string | null
  ends_at: string | null
  priority: number
  pages: string[]
  dismissible: boolean
  dismiss_version: number
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PopupRow {
  id: 'nurse_kin'
  launcher_label: string
  enabled: boolean
  status: 'draft' | 'published'
  headline: string
  body: string
  cta_label: string
  url: string
  image_key: string | null
  image_type: string | null
  image_alt: string
  theme: (typeof THEMES)[number]
  delay_seconds: number
  scroll_percent: number
  suppress_days: number
  pages: string[]
  starts_at: string | null
  ends_at: string | null
  campaign_version: number
  published_at: string | null
  updated_by: string | null
  updated_at: string
}

/* ---------- Validation ---------- */

/** Internal page (#shop, #product-np-binder) or an https address. Nothing else. */
export function linkField(v: unknown, field: string, { httpsOnly = false, optional = true } = {}): string {
  const s = str(v, field, { max: 500, optional })
  if (!s) return ''
  if (!httpsOnly && /^#[a-z0-9][a-z0-9-]*$/.test(s)) return s
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw badRequest(`${field} must be ${httpsOnly ? 'a full https:// address' : 'a page on this site (like #shop) or a full https:// address'}.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) {
    throw badRequest(`${field} must be a secure https:// address.`)
  }
  return url.toString()
}

function pagesField(v: unknown, allowAll: boolean): string[] {
  const list = Array.isArray(v) ? v.map(String) : []
  if (allowAll && list.includes('all')) return ['all']
  const clean = [...new Set(list.filter((p) => (PAGES as readonly string[]).includes(p)))]
  if (!clean.length) throw badRequest('Choose at least one page.')
  return clean
}

function optionalDate(v: unknown, field: string): Date | null {
  if (v === null || v === undefined || v === '') return null
  return isoDate(v, field)
}

function text(v: unknown, field: string, max: number) {
  // Plain text only: collapse stray whitespace, keep single line breaks.
  return str(v, field, { max, optional: true })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function bannerInput(b: Record<string, unknown>) {
  const style = oneOf(b.style, 'Banner style', STYLES)
  const placement = style === 'announcement' ? 'top' : oneOf(b.placement, 'Placement', ['below_hero', 'above_freebies'] as const)
  const startsAt = optionalDate(b.starts_at, 'Start')
  const endsAt = optionalDate(b.ends_at, 'End')
  if (startsAt && endsAt && endsAt <= startsAt) throw badRequest('The end must be after the start.')
  const out = {
    name: str(b.name, 'Internal name', { min: 1, max: 80 }),
    style,
    placement,
    headline: text(b.headline, 'Headline', style === 'announcement' ? 120 : 90),
    body: style === 'announcement' ? '' : text(b.body, 'Supporting text', 280),
    button_label: text(b.button_label, 'Button label', 30),
    link: linkField(b.link, 'Button destination'),
    image_alt: style === 'image' ? text(b.image_alt, 'Image description', 160) : '',
    theme: oneOf(b.theme, 'Theme', THEMES, 'blush'),
    icon: oneOf(b.icon, 'Icon', ICONS, 'none'),
    coupon_code: str(b.coupon_code, 'Coupon code', { max: 40, optional: true }).trim().toUpperCase(),
    starts_at: startsAt,
    ends_at: endsAt,
    priority: int(b.priority ?? 10, 'Priority', { min: 1, max: 100 })!,
    pages: placement === 'top' ? pagesField(b.pages ?? ['all'], true) : ['home'],
    dismissible: b.dismissible === undefined ? true : bool(b.dismissible),
  }
  if (out.coupon_code && !/^[A-Z0-9_-]{2,40}$/.test(out.coupon_code)) throw badRequest('Coupon codes use letters, numbers, dashes or underscores only.')
  if (out.button_label && !out.link) throw badRequest('A button needs a destination.')
  if (out.link && !out.button_label && style !== 'announcement') throw badRequest('Add a button label for the destination, or remove the destination.')
  return out
}

/** Nurse Kin launcher: a button visitors choose to open. It never opens by itself. */
export function popupInput(b: Record<string, unknown>) {
  const startsAt = optionalDate(b.starts_at, 'Start')
  const endsAt = optionalDate(b.ends_at, 'End')
  if (startsAt && endsAt && endsAt <= startsAt) throw badRequest('The end must be after the start.')
  return {
    launcher_label: text(b.launcher_label, 'Launcher label', 30),
    headline: text(b.headline, 'Headline', 80),
    body: text(b.body, 'Body copy', 400),
    cta_label: text(b.cta_label, 'Button label', 30),
    url: linkField(b.url, 'Nurse Kin address', { httpsOnly: true }),
    image_alt: text(b.image_alt, 'Image description', 160),
    theme: oneOf(b.theme, 'Theme', THEMES, 'blush'),
    starts_at: startsAt,
    ends_at: endsAt,
  }
}

/* ---------- States ---------- */

export type LiveState = 'draft' | 'archived' | 'inactive' | 'scheduled' | 'live' | 'expired'

function windowEnd(b: { ends_at: string | null; coupon_expires_at?: string | null; coupon_code?: string }) {
  const ends = [b.ends_at, b.coupon_code ? b.coupon_expires_at : null].filter(Boolean).map((d) => new Date(d!).getTime())
  return ends.length ? Math.min(...ends) : null
}

export function bannerState(b: BannerRow, now = Date.now()): LiveState {
  if (b.status === 'archived') return 'archived'
  if (b.status === 'draft') return 'draft'
  if (!b.active) return 'inactive'
  const end = windowEnd(b)
  if (end !== null && end <= now) return 'expired'
  if (b.starts_at && new Date(b.starts_at).getTime() > now) return 'scheduled'
  return 'live'
}

export function popupProblems(p: Pick<PopupRow, 'launcher_label' | 'headline' | 'body' | 'cta_label' | 'url'>) {
  const problems: string[] = []
  if (!p.launcher_label) problems.push('Add the launcher label (for example "Meet Nurse Kin").')
  if (!p.url) problems.push('Add the Nurse Kin address (https://...).')
  if (!p.headline) problems.push('Add a headline.')
  if (!p.body) problems.push('Add a short description of Nurse Kin.')
  if (!p.cta_label) problems.push('Add a button label.')
  return problems
}

export function popupState(p: PopupRow, now = Date.now()): LiveState {
  if (p.status === 'draft') return 'draft'
  if (!p.enabled || popupProblems(p).length) return 'inactive'
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return 'expired'
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return 'scheduled'
  return 'live'
}

function overlaps(a: BannerRow, b: BannerRow) {
  const aStart = a.starts_at ? new Date(a.starts_at).getTime() : -Infinity
  const bStart = b.starts_at ? new Date(b.starts_at).getTime() : -Infinity
  const aEnd = windowEnd(a) ?? Infinity
  const bEnd = windowEnd(b) ?? Infinity
  const pagesShared = a.pages.includes('all') || b.pages.includes('all') || a.pages.some((p) => b.pages.includes(p))
  return a.placement === b.placement && pagesShared && aStart < bEnd && bStart < aEnd
}

/** Published, active banners whose schedules overlap in the same placement. Only one shows at a time. */
export function bannerConflicts(rows: BannerRow[], now = Date.now()) {
  const candidates = rows.filter((b) => ['live', 'scheduled'].includes(bannerState(b, now)))
  const out: Record<string, string[]> = {}
  for (const a of candidates) for (const b of candidates) if (a.id !== b.id && overlaps(a, b)) (out[a.id] ??= []).push(b.name)
  return out
}

/** The single popup row, created on first use if it is missing. */
async function popupRow() {
  await q(`insert into marketing_popup (id) values ('nurse_kin') on conflict (id) do nothing`)
  return (await one<PopupRow>(`select * from marketing_popup where id = 'nurse_kin'`))!
}

/* ---------- Admin ---------- */

const PLACEMENT_LABEL: Record<string, string> = { top: 'Announcement bar', below_hero: 'Below the home page hero', above_freebies: 'Above the Freebie Corner' }

export async function listBanners() {
  const rows = await q<BannerRow>(`select * from marketing_banners order by (status = 'archived'), placement, priority, published_at desc nulls last, created_at desc`)
  const conflicts = bannerConflicts(rows)
  const stats = await q<{ item_id: string; views: number; clicks: number; dismissals: number }>(
    `select item_id, sum(views)::int as views, sum(clicks)::int as clicks, sum(dismissals)::int as dismissals from marketing_stats where kind = 'banner' group by item_id`,
  )
  return rows.map((b) => {
    const s = stats.find((x) => x.item_id === b.id) ?? { views: 0, clicks: 0, dismissals: 0 }
    return { ...b, state: bannerState(b), conflictsWith: conflicts[b.id] ?? [], placementLabel: PLACEMENT_LABEL[b.placement], stats: { views: s.views, clicks: s.clicks, dismissals: s.dismissals } }
  })
}

export async function getBanner(id: string) {
  const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
  if (!b) throw notFound('Banner')
  const all = await q<BannerRow>('select * from marketing_banners')
  return { ...b, state: bannerState(b), conflictsWith: bannerConflicts(all)[b.id] ?? [] }
}

export async function createBanner(actor: SessionUser, body: Record<string, unknown>, ip?: string) {
  const v = bannerInput(body)
  const row = await one<{ id: string }>(
    `insert into marketing_banners (name, style, placement, headline, body, button_label, link, image_alt, theme, icon, coupon_code, starts_at, ends_at, priority, pages, dismissible, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [v.name, v.style, v.placement, v.headline, v.body, v.button_label, v.link, v.image_alt, v.theme, v.icon, v.coupon_code, v.starts_at, v.ends_at, v.priority, v.pages, v.dismissible, actor.email],
  )
  await audit({ actor, action: 'marketing.banner_created', entityType: 'banner', entityId: row!.id, summary: `Created banner draft "${v.name}"`, ip })
  return row!
}

export async function updateBanner(actor: SessionUser, id: string, body: Record<string, unknown>, ip?: string) {
  const current = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
  if (!current) throw notFound('Banner')
  if (current.status === 'archived') throw badRequest('Restore this banner before editing it.')
  const v = bannerInput(body)
  if (v.style !== current.style && current.image_key && v.style !== 'image') {
    await q('update marketing_banners set image_key = null, image_type = null where id = $1', [id])
  }
  // A new or changed code must be checked again before it can show. On a
  // published banner it is checked first, so a bad code rejects the whole edit.
  const codeChanged = v.coupon_code !== current.coupon_code
  const checked = current.status === 'published' && codeChanged && v.coupon_code ? await checkCode(v.coupon_code) : null
  await q(
    `update marketing_banners set name=$2, style=$3, placement=$4, headline=$5, body=$6, button_label=$7, link=$8, image_alt=$9, theme=$10, icon=$11, coupon_code=$12,
       starts_at=$13, ends_at=$14, priority=$15, pages=$16, dismissible=$17, updated_at=now()
       ${codeChanged ? ', coupon_offer=$18, coupon_expires_at=$19, coupon_checked_at=$20' : ''}
     where id = $1`,
    [id, v.name, v.style, v.placement, v.headline, v.body, v.button_label, v.link, v.image_alt, v.theme, v.icon, v.coupon_code, v.starts_at, v.ends_at, v.priority, v.pages, v.dismissible,
      ...(codeChanged ? [checked?.offer ?? '', checked?.expiresAt ?? null, checked ? new Date() : null] : [])],
  )
  if (current.status === 'published') {
    await audit({ actor, action: 'marketing.banner_edited', entityType: 'banner', entityId: id, summary: `Edited published banner "${v.name}"`, ip })
  }
  return getBanner(id)
}

async function assertPublishable(b: BannerRow) {
  if (!b.headline) throw badRequest('Add a headline before publishing.')
  if (b.style === 'image' && b.image_key && !b.image_alt) throw badRequest('Describe the image (alt text) before publishing.')
}

export async function setBannerStatus(actor: SessionUser, id: string, action: 'publish' | 'unpublish' | 'activate' | 'deactivate' | 'archive' | 'restore' | 'reset_dismissals', ip?: string) {
  const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
  if (!b) throw notFound('Banner')
  if (action === 'publish') {
    await assertPublishable(b)
    if (b.coupon_code) await refreshCoupon(id)
    await q(`update marketing_banners set status='published', published_at=now(), updated_at=now() where id = $1`, [id])
  } else if (action === 'unpublish') await q(`update marketing_banners set status='draft', updated_at=now() where id = $1`, [id])
  else if (action === 'activate') await q(`update marketing_banners set active=true, updated_at=now() where id = $1`, [id])
  else if (action === 'deactivate') await q(`update marketing_banners set active=false, updated_at=now() where id = $1`, [id])
  else if (action === 'archive') await q(`update marketing_banners set status='archived', updated_at=now() where id = $1`, [id])
  else if (action === 'restore') await q(`update marketing_banners set status='draft', updated_at=now() where id = $1`, [id])
  else await q(`update marketing_banners set dismiss_version = dismiss_version + 1, updated_at=now() where id = $1`, [id])
  const words: Record<string, string> = { publish: 'Published', unpublish: 'Unpublished', activate: 'Activated', deactivate: 'Deactivated', archive: 'Archived', restore: 'Restored', reset_dismissals: 'Showed again to visitors who closed' }
  await audit({ actor, action: `marketing.banner_${action}`, entityType: 'banner', entityId: id, summary: `${words[action]} banner "${b.name}"`, ip })
  return getBanner(id)
}

export async function duplicateBanner(actor: SessionUser, id: string, ip?: string) {
  const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
  if (!b) throw notFound('Banner')
  // The copy starts as a draft without the image (images are not shared between banners) and without a checked coupon.
  const row = await one<{ id: string }>(
    `insert into marketing_banners (name, style, placement, headline, body, button_label, link, image_alt, theme, icon, coupon_code, starts_at, ends_at, priority, pages, dismissible, created_by)
     select left('Copy of ' || name, 80), style, placement, headline, body, button_label, link, image_alt, theme, icon, coupon_code, starts_at, ends_at, priority, pages, dismissible, $2
       from marketing_banners where id = $1 returning id`,
    [id, actor.email],
  )
  await audit({ actor, action: 'marketing.banner_duplicated', entityType: 'banner', entityId: row!.id, summary: `Duplicated banner "${b.name}"`, ip })
  return row!
}

export async function getPopup() {
  const p = (await popupRow())
  const stats = await one<{ views: number; clicks: number; dismissals: number }>(
    `select coalesce(sum(views),0)::int as views, coalesce(sum(clicks),0)::int as clicks, coalesce(sum(dismissals),0)::int as dismissals from marketing_stats where kind = 'popup' and version = $1`,
    [p.campaign_version],
  )
  return { ...p, state: popupState(p), problems: popupProblems(p), stats }
}

export async function updatePopup(actor: SessionUser, body: Record<string, unknown>, ip?: string) {
  const v = popupInput(body)
  const current = (await popupRow())
  if (current.status === 'published' && popupProblems(v).length) throw badRequest(`The popup is published, so it must stay complete: ${popupProblems(v).join(' ')}`)
  await q(
    `update marketing_popup set launcher_label=$1, headline=$2, body=$3, cta_label=$4, url=$5, image_alt=$6, theme=$7, starts_at=$8, ends_at=$9, updated_by=$10, updated_at=now() where id = 'nurse_kin'`,
    [v.launcher_label, v.headline, v.body, v.cta_label, v.url, v.image_alt, v.theme, v.starts_at, v.ends_at, actor.email],
  )
  if (current.status === 'published') await audit({ actor, action: 'marketing.popup_edited', entityType: 'popup', entityId: 'nurse_kin', summary: 'Edited the published Nurse Kin popup', ip })
  return getPopup()
}

export async function setPopupStatus(actor: SessionUser, action: 'publish' | 'unpublish' | 'enable' | 'disable' | 'reset_campaign', ip?: string) {
  const p = (await popupRow())
  if (action === 'publish') {
    const problems = popupProblems(p)
    if (problems.length) throw badRequest(`The popup cannot be published yet. ${problems.join(' ')}`)
    if (p.image_key && !p.image_alt) throw badRequest('Describe the image (alt text) before publishing.')
    await q(`update marketing_popup set status='published', enabled=true, published_at=now(), updated_by=$1, updated_at=now() where id = 'nurse_kin'`, [actor.email])
  } else if (action === 'unpublish') await q(`update marketing_popup set status='draft', updated_by=$1, updated_at=now() where id = 'nurse_kin'`, [actor.email])
  else if (action === 'enable') await q(`update marketing_popup set enabled=true, updated_by=$1, updated_at=now() where id = 'nurse_kin'`, [actor.email])
  else if (action === 'disable') await q(`update marketing_popup set enabled=false, updated_by=$1, updated_at=now() where id = 'nurse_kin'`, [actor.email])
  else await q(`update marketing_popup set campaign_version = campaign_version + 1, updated_by=$1, updated_at=now() where id = 'nurse_kin'`, [actor.email])
  const words: Record<string, string> = { publish: 'Published', unpublish: 'Unpublished', enable: 'Switched on', disable: 'Switched off', reset_campaign: 'Started a new campaign version of' }
  await audit({ actor, action: `marketing.popup_${action}`, entityType: 'popup', entityId: 'nurse_kin', summary: `${words[action]} the Nurse Kin popup`, ip })
  return getPopup()
}

/* ---------- Coupons: only real Stripe promotion codes ---------- */

export interface PromoTerms {
  active: boolean
  percentOff: number | null
  amountOffCents: number | null
  currency: string | null
  expiresAt: string | null
  minimumCents: number | null
  firstOrderOnly: boolean
  limitedProducts: boolean
}

type PromoLookup = (code: string) => Promise<PromoTerms | null>
let lookupOverride: PromoLookup | null = null
/** Tests replace the Stripe lookup. */
export function setPromoLookup(fn: PromoLookup | null) {
  lookupOverride = fn
}

async function stripeLookup(code: string): Promise<PromoTerms | null> {
  const list = await stripe().promotionCodes.list({ code, limit: 1, expand: ['data.promotion.coupon'] })
  const pc = list.data[0]
  if (!pc) return null
  const coupon = typeof pc.promotion.coupon === 'object' ? pc.promotion.coupon : null
  if (!coupon) return null
  const expiries = [pc.expires_at, coupon.redeem_by].filter((x): x is number => typeof x === 'number')
  return {
    active: pc.active && coupon.valid,
    percentOff: coupon.percent_off ?? null,
    amountOffCents: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    expiresAt: expiries.length ? new Date(Math.min(...expiries) * 1000).toISOString() : null,
    minimumCents: pc.restrictions.minimum_amount ?? null,
    firstOrderOnly: Boolean(pc.restrictions.first_time_transaction),
    limitedProducts: Boolean(coupon.applies_to?.products?.length),
  }
}

export async function lookupPromo(code: string) {
  if (!lookupOverride && !stripeAvailable()) {
    throw new HttpError(409, 'Coupon codes can only be shown once Stripe is connected, so each code is checked against a real discount. Create the promotion code in Stripe first.', 'coupon_needs_stripe')
  }
  return (lookupOverride ?? stripeLookup)(code)
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/** The offer exactly as Stripe defines it, with every qualifier that applies. */
export function offerText(code: string, t: PromoTerms) {
  const amount = t.percentOff ? `${t.percentOff}% off` : t.amountOffCents ? `${money(t.amountOffCents)} off` : 'a discount'
  const parts = [`Use code ${code} for ${amount}`]
  if (t.limitedProducts) parts.push('on selected items')
  if (t.minimumCents) parts.push(`on orders of ${money(t.minimumCents)} or more`)
  if (t.firstOrderOnly) parts.push('on your first order')
  return `${parts.join(' ')} at checkout.`
}

/** Confirms a code is a live Stripe discount and returns the offer text from its real terms. */
export async function checkCode(code: string) {
  const terms = await lookupPromo(code)
  if (!terms || !terms.active) throw badRequest(`"${code}" is not an active promotion code in Stripe. Create or switch it on in Stripe first; the banner never creates a discount.`)
  if (terms.expiresAt && new Date(terms.expiresAt).getTime() <= Date.now()) throw badRequest(`"${code}" has already expired in Stripe.`)
  return { terms, offer: offerText(code, terms), expiresAt: terms.expiresAt }
}

/** Checks the banner's code with Stripe and stores the real terms. Throws if it is not a live discount. */
export async function refreshCoupon(id: string) {
  const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
  if (!b?.coupon_code) return
  const c = await checkCode(b.coupon_code)
  await q(`update marketing_banners set coupon_offer = $2, coupon_expires_at = $3, coupon_checked_at = now() where id = $1`, [id, c.offer, c.expiresAt])
  return c.terms
}

/** Scheduled job: a published coupon banner whose code was switched off in Stripe stops showing. */
export async function recheckCoupons() {
  const rows = await q<{ id: string; name: string }>(`select id, name from marketing_banners where status = 'published' and active and coupon_code <> ''`)
  let stopped = 0
  for (const r of rows) {
    try {
      await refreshCoupon(r.id)
    } catch (err) {
      if ((err as HttpError).code === 'coupon_needs_stripe') continue
      await q(`update marketing_banners set active = false, updated_at = now() where id = $1`, [r.id])
      await audit({ actor: null, action: 'marketing.banner_deactivated', entityType: 'banner', entityId: r.id, summary: `Stopped banner "${r.name}": its coupon code is no longer an active discount in Stripe.` })
      stopped++
    }
  }
  return stopped
}

/* ---------- Public ---------- */

/** What the storefront may show right now. Nothing here is a draft, inactive or outside its schedule. */
export async function publicMarketing(now = Date.now()) {
  const rows = await q<BannerRow>(`select * from marketing_banners where status = 'published' and active order by priority, published_at desc`)
  const banners = rows
    .filter((b) => bannerState(b, now) === 'live')
    .map((b) => ({
      id: b.id,
      style: b.style,
      placement: b.placement,
      headline: b.headline,
      body: b.body,
      buttonLabel: b.button_label,
      link: b.link,
      image: b.style === 'image' && b.image_key ? { url: `/api/marketing/banners/${b.id}/image`, alt: b.image_alt } : null,
      theme: b.theme,
      icon: b.icon,
      couponCode: b.coupon_code && b.coupon_offer ? b.coupon_code : '',
      couponOffer: b.coupon_code ? b.coupon_offer : '',
      endsAt: windowEnd(b) ? new Date(windowEnd(b)!).toISOString() : null,
      pages: b.pages,
      dismissible: b.dismissible,
      dismissVersion: b.dismiss_version,
    }))
  const p = (await popupRow())
  const popup =
    popupState(p, now) === 'live'
      ? {
          launcherLabel: p.launcher_label,
          headline: p.headline,
          body: p.body,
          ctaLabel: p.cta_label,
          url: p.url,
          image: p.image_key ? { url: '/api/marketing/popup/image', alt: p.image_alt } : null,
          theme: p.theme,
          version: p.campaign_version,
        }
      : null
  return { banners, popup }
}

/** Image of a live banner or popup (admins may also see drafts). */
export async function marketingImage(kind: 'banner' | 'popup', id: string, admin: boolean) {
  if (kind === 'banner') {
    const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
    if (!b?.image_key || (!admin && bannerState(b) !== 'live')) throw notFound('Image')
    return { key: b.image_key, type: b.image_type ?? 'image/jpeg' }
  }
  const p = (await popupRow())
  if (!p.image_key || (!admin && popupState(p) !== 'live')) throw notFound('Image')
  return { key: p.image_key, type: p.image_type ?? 'image/jpeg' }
}

/** Aggregate counts. Only live items count, so drafts and previews never add numbers. */
export async function recordEvent(kind: 'banner' | 'popup', id: string, version: number, event: 'view' | 'click' | 'dismiss') {
  if (kind === 'banner') {
    const b = await one<BannerRow>('select * from marketing_banners where id = $1', [id])
    if (!b || bannerState(b) !== 'live' || b.dismiss_version !== version) return false
  } else {
    const p = (await popupRow())
    if (id !== 'nurse_kin' || popupState(p) !== 'live' || p.campaign_version !== version) return false
  }
  const col = event === 'view' ? 'views' : event === 'click' ? 'clicks' : 'dismissals'
  await q(
    `insert into marketing_stats (kind, item_id, version, day, ${col}) values ($1,$2,$3,current_date,1)
     on conflict (kind, item_id, version, day) do update set ${col} = marketing_stats.${col} + 1`,
    [kind, id, version],
  )
  return true
}

export async function attachMarketingImage(kind: 'banner' | 'popup', id: string, key: string, type: string) {
  if (kind === 'banner') {
    const b = await one<BannerRow>('select style from marketing_banners where id = $1', [id])
    if (!b) throw notFound('Banner')
    if (b.style !== 'image') throw conflict('Only image and text banners have an image.')
    await q(`update marketing_banners set image_key = $2, image_type = $3, updated_at = now() where id = $1`, [id, key, type])
  } else {
    await q(`update marketing_popup set image_key = $1, image_type = $2, updated_at = now() where id = 'nurse_kin'`, [key, type])
  }
}

export async function removeMarketingImage(kind: 'banner' | 'popup', id: string) {
  if (kind === 'banner') await q(`update marketing_banners set image_key = null, image_type = null, updated_at = now() where id = $1`, [id])
  else await q(`update marketing_popup set image_key = null, image_type = null, updated_at = now() where id = 'nurse_kin'`)
}
