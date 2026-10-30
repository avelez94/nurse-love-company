import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { recheckCoupons, setPromoLookup, type PromoTerms } from '../services/marketing.js'
import { api, one, q, setup, signUp, teardown } from './helpers.js'

beforeEach(async () => {
  await setup()
  setPromoLookup(null)
})
after(teardown)

function png() {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(1200, 16)
  b.writeUInt32BE(600, 20)
  return b
}

const strip = (extra: Record<string, unknown> = {}) => ({
  name: 'Spring strip',
  style: 'strip',
  placement: 'below_hero',
  headline: 'Fresh resources, special savings.',
  body: 'New printable inserts for your binder.',
  button_label: 'Shop now',
  link: '#shop',
  theme: 'blush',
  ...extra,
})
const bar = (extra: Record<string, unknown> = {}) => ({ name: 'Top bar', style: 'announcement', headline: 'New NP inserts are here.', link: '#np-inserts', button_label: 'See them', ...extra })

async function admin() {
  return signUp('owner@example.com', 'admin')
}
async function create(a: Awaited<ReturnType<typeof admin>>, body: Record<string, unknown>) {
  const r = await api('/api/admin/marketing/banners', { session: a, body })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  return r.data.id as string
}
const publicFeed = async () => (await api('/api/marketing')).data as { banners: Array<Record<string, any>>; popup: Record<string, any> | null }

describe('banners', () => {
  it('only admins can manage them', async () => {
    const shopper = await signUp('shopper@example.com')
    assert.equal((await api('/api/admin/marketing/banners')).status, 401)
    assert.equal((await api('/api/admin/marketing/banners', { session: shopper })).status, 403)
    assert.equal((await api('/api/admin/marketing/banners', { session: shopper, body: strip() })).status, 403)
    assert.equal((await api('/api/admin/marketing/popup', { session: shopper, method: 'PUT', body: {} })).status, 403)
  })

  it('drafts stay private; publish, deactivate and archive control what the public sees, with audit records', async () => {
    const a = await admin()
    const id = await create(a, strip())
    assert.equal((await publicFeed()).banners.length, 0, 'drafts are private')
    const pub = await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    assert.equal(pub.data.state, 'live')
    const feed = await publicFeed()
    assert.equal(feed.banners.length, 1)
    assert.equal(feed.banners[0].headline, 'Fresh resources, special savings.')
    assert.equal(feed.banners[0].couponCode, '')
    await api(`/api/admin/marketing/banners/${id}/deactivate`, { session: a, method: 'POST' })
    assert.equal((await publicFeed()).banners.length, 0)
    await api(`/api/admin/marketing/banners/${id}/activate`, { session: a, method: 'POST' })
    await api(`/api/admin/marketing/banners/${id}/archive`, { session: a, method: 'POST' })
    assert.equal((await publicFeed()).banners.length, 0)
    const actions = (await q<{ action: string }>(`select action from audit_log where entity_id = $1 order by id`, [id])).map((r) => r.action)
    assert.deepEqual(actions, ['marketing.banner_created', 'marketing.banner_publish', 'marketing.banner_deactivate', 'marketing.banner_activate', 'marketing.banner_archive'])

    const copy = await api(`/api/admin/marketing/banners/${id}/duplicate`, { session: a, method: 'POST' })
    assert.equal((await api(`/api/admin/marketing/banners/${copy.data.id}`, { session: a })).data.status, 'draft')
  })

  it('respects start and end times', async () => {
    const a = await admin()
    const id = await create(a, strip({ starts_at: new Date(Date.now() + 3600_000).toISOString() }))
    assert.equal((await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })).data.state, 'scheduled')
    assert.equal((await publicFeed()).banners.length, 0, 'not before its start')
    await q(`update marketing_banners set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' where id = $1`, [id])
    assert.equal((await api(`/api/admin/marketing/banners/${id}`, { session: a })).data.state, 'expired')
    assert.equal((await publicFeed()).banners.length, 0, 'not after its end')
    await q(`update marketing_banners set ends_at = now() + interval '1 hour' where id = $1`, [id])
    const live = await publicFeed()
    assert.equal(live.banners.length, 1)
    assert.ok(live.banners[0].endsAt, 'the real end time is exposed, so no invented countdown is needed')
    assert.equal((await api('/api/admin/marketing/banners', { session: a, body: strip({ starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' }) })).status, 400)
  })

  it('one banner per placement: lowest priority number first, and overlaps are reported', async () => {
    const a = await admin()
    const low = await create(a, bar({ name: 'Shipping notice', priority: 20 }))
    const high = await create(a, bar({ name: 'Sale', priority: 5 }))
    const other = await create(a, strip())
    for (const id of [low, high, other]) await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    const top = (await publicFeed()).banners.filter((b) => b.placement === 'top')
    assert.deepEqual(top.map((b) => b.headline), ['New NP inserts are here.', 'New NP inserts are here.'])
    assert.deepEqual(top.map((b) => b.id), [high, low], 'the storefront shows the first; the rest wait')
    const list = (await api('/api/admin/marketing/banners', { session: a })).data.banners as Array<{ id: string; conflictsWith: string[] }>
    assert.deepEqual(list.find((b) => b.id === high)!.conflictsWith, ['Shipping notice'])
    assert.deepEqual(list.find((b) => b.id === other)!.conflictsWith, [], 'different placements do not conflict')
  })

  it('validates destinations, styles and copy', async () => {
    const a = await admin()
    for (const link of ['javascript:alert(1)', 'http://example.com', 'data:text/html,hi', '//evil.example', 'https://user:pw@example.com', '#Shop Now']) {
      assert.equal((await api('/api/admin/marketing/banners', { session: a, body: strip({ link }) })).status, 400, link)
    }
    assert.equal((await api('/api/admin/marketing/banners', { session: a, body: strip({ link: 'https://nursekin.example/join' }) })).status, 201)
    assert.equal((await api('/api/admin/marketing/banners', { session: a, body: strip({ theme: 'purple' }) })).status, 400)
    assert.equal((await api('/api/admin/marketing/banners', { session: a, body: strip({ button_label: 'Go', link: '' }) })).status, 400)
    // Copy is stored as plain text; the storefront renders it as text, never as HTML.
    const id = await create(a, strip({ headline: '<img src=x onerror=alert(1)>Sale' }))
    await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    assert.equal((await publicFeed()).banners[0].headline, '<img src=x onerror=alert(1)>Sale')
    // An announcement is always the top bar; strips never are.
    const ann = await create(a, bar({ placement: 'below_hero' }))
    assert.equal((await one<{ placement: string }>('select placement from marketing_banners where id = $1', [ann]))!.placement, 'top')
  })
})

describe('sale banners and coupon codes', () => {
  const terms = (extra: Partial<PromoTerms> = {}): PromoTerms => ({ active: true, percentOff: 15, amountOffCents: null, currency: null, expiresAt: null, minimumCents: 2000, firstOrderOnly: false, limitedProducts: true, ...extra })

  it('a code is never shown unless Stripe has a real active discount, and the offer comes from its terms', async () => {
    const a = await admin()
    const id = await create(a, strip({ coupon_code: 'nurse15' }))
    // Stripe is not configured in tests: publishing a coupon banner is refused.
    const refused = await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    assert.equal(refused.status, 409)
    assert.equal(refused.data.code, 'coupon_needs_stripe')

    setPromoLookup(async () => terms({ active: false }))
    assert.equal((await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })).status, 400)
    assert.equal((await publicFeed()).banners.length, 0)

    setPromoLookup(async () => terms({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() }))
    assert.equal((await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })).status, 200)
    const b = (await publicFeed()).banners[0]
    assert.equal(b.couponCode, 'NURSE15')
    assert.equal(b.couponOffer, 'Use code NURSE15 for 15% off on selected items on orders of $20 or more at checkout.')
    assert.ok(b.endsAt, 'the banner ends when the discount ends')

    // When the discount expires, the banner stops showing even if its own end is later.
    await q(`update marketing_banners set coupon_expires_at = now() - interval '1 second' where id = $1`, [id])
    assert.equal((await publicFeed()).banners.length, 0)

    // A code switched off in Stripe deactivates the banner at the next scheduled check.
    await q(`update marketing_banners set coupon_expires_at = null where id = $1`, [id])
    setPromoLookup(async () => null)
    assert.equal(await recheckCoupons(), 1)
    assert.equal((await publicFeed()).banners.length, 0)
    assert.ok(await one(`select 1 from audit_log where entity_id = $1 and action = 'marketing.banner_deactivated'`, [id]))
  })

  it('changing the code on a published banner is checked before anything is saved', async () => {
    const a = await admin()
    setPromoLookup(async (code) => (code === 'GOOD10' ? terms({ percentOff: 10, minimumCents: null, limitedProducts: false }) : null))
    const id = await create(a, strip({ coupon_code: 'GOOD10' }))
    await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    const bad = await api(`/api/admin/marketing/banners/${id}`, { session: a, method: 'PUT', body: strip({ coupon_code: 'FAKE50' }) })
    assert.equal(bad.status, 400)
    const row = await one<{ coupon_code: string; coupon_offer: string }>('select coupon_code, coupon_offer from marketing_banners where id = $1', [id])
    assert.deepEqual(row, { coupon_code: 'GOOD10', coupon_offer: 'Use code GOOD10 for 10% off at checkout.' })
  })
})

describe('Nurse Kin popup', () => {
  const copy = { headline: 'Meet Nurse Kin', body: 'Approved description from the owner.', cta_label: 'Visit Nurse Kin', url: 'https://nursekin.example', pages: ['home', 'shop'] }

  it('stays private until it is complete and published; never on excluded pages; campaign reset raises the version', async () => {
    const a = await admin()
    assert.equal((await publicFeed()).popup, null)
    const blank = await api('/api/admin/marketing/popup/publish', { session: a, method: 'POST' })
    assert.equal(blank.status, 400)
    assert.match(blank.data.error, /Nurse Kin address/)
    assert.equal((await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { ...copy, url: 'http://nursekin.example' } })).status, 400)
    assert.equal((await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { ...copy, pages: ['account', 'sign-in'] } })).status, 400, 'only public storefront pages can be chosen')
    assert.equal((await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { ...copy, delay_seconds: 2 } })).status, 400)
    assert.equal((await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: copy })).status, 200)
    assert.equal((await publicFeed()).popup, null, 'saved but not published')

    const pub = await api('/api/admin/marketing/popup/publish', { session: a, method: 'POST' })
    assert.equal(pub.data.state, 'live')
    const popup = (await publicFeed()).popup!
    assert.deepEqual([popup.url, popup.delaySeconds, popup.suppressDays, popup.version, popup.pages], ['https://nursekin.example/', 30, 7, 1, ['home', 'shop']])

    // While published it must stay complete.
    assert.equal((await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { ...copy, url: '' } })).status, 400)

    await api('/api/admin/marketing/popup/disable', { session: a, method: 'POST' })
    assert.equal((await publicFeed()).popup, null)
    await api('/api/admin/marketing/popup/enable', { session: a, method: 'POST' })
    await api('/api/admin/marketing/popup/reset_campaign', { session: a, method: 'POST' })
    assert.equal((await publicFeed()).popup!.version, 2)
    assert.ok(await one(`select 1 from audit_log where action = 'marketing.popup_publish'`))
  })
})

describe('marketing statistics and images', () => {
  it('counts only live items as aggregate numbers; a popup click is a click, not a signup', async () => {
    const a = await admin()
    const id = await create(a, strip())
    const ev = (body: Record<string, unknown>) => api('/api/marketing/events', { body })
    assert.equal((await ev({ kind: 'banner', id, version: 1, event: 'view' })).data.counted, false, 'drafts and previews never count')
    await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    await ev({ kind: 'banner', id, version: 1, event: 'view' })
    await ev({ kind: 'banner', id, version: 1, event: 'view' })
    await ev({ kind: 'banner', id, version: 1, event: 'click' })
    assert.equal((await ev({ kind: 'banner', id, version: 9, event: 'view' })).data.counted, false)
    const listed = (await api('/api/admin/marketing/banners', { session: a })).data.banners[0]
    assert.deepEqual(listed.stats, { views: 2, clicks: 1, dismissals: 0 })

    await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { headline: 'Meet Nurse Kin', body: 'Approved.', cta_label: 'Visit Nurse Kin', url: 'https://nursekin.example', pages: ['home'] } })
    await api('/api/admin/marketing/popup/publish', { session: a, method: 'POST' })
    await ev({ kind: 'popup', id: 'nurse_kin', version: 1, event: 'view' })
    await ev({ kind: 'popup', id: 'nurse_kin', version: 1, event: 'click' })
    await ev({ kind: 'popup', id: 'nurse_kin', version: 1, event: 'dismiss' })
    assert.deepEqual((await api('/api/admin/marketing/popup', { session: a })).data.stats, { views: 1, clicks: 1, dismissals: 1 })
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'marketing_stats' order by ordinal_position`)).map((r) => r.column_name)
    assert.deepEqual(cols, ['kind', 'item_id', 'version', 'day', 'views', 'clicks', 'dismissals'], 'no visitor identifiers are stored')
  })

  it('banner images are private until the banner is live', async () => {
    const a = await admin()
    const id = await create(a, strip({ style: 'image', image_alt: 'Printed planner pages on a desk' }))
    const up = await api(`/api/admin/marketing/banners/${id}/image`, { session: a, body: png(), headers: { 'content-type': 'image/png', 'x-file-name': 'desk.png' } })
    assert.equal(up.status, 201, `upload: ${JSON.stringify(up.data)}`)
    assert.equal((await api(`/api/marketing/banners/${id}/image`)).status, 404)
    assert.equal((await api(`/api/admin/marketing/banners/${id}/preview-image`, { session: a })).status, 200)
    await api(`/api/admin/marketing/banners/${id}/publish`, { session: a, method: 'POST' })
    assert.equal((await api(`/api/marketing/banners/${id}/image`)).status, 200)
    assert.deepEqual((await publicFeed()).banners[0].image, { url: `/api/marketing/banners/${id}/image`, alt: 'Printed planner pages on a desk' })
    // The popup image follows the same rule.
    assert.equal((await api('/api/admin/marketing/popup/image', { session: a, body: png(), headers: { 'content-type': 'image/png', 'x-file-name': 'logo.png' } })).status, 201)
    assert.equal((await api('/api/marketing/popup/image')).status, 404, 'popup is still a draft')
    assert.equal((await api('/api/admin/marketing/popup/preview-image', { session: a })).status, 200)
    // Strips have no image.
    const plain = await create(a, strip())
    assert.equal((await api(`/api/admin/marketing/banners/${plain}/image`, { session: a, body: png(), headers: { 'content-type': 'image/png', 'x-file-name': 'x.png' } })).status, 409)
  })
})
