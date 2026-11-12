import './env.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { setStripeForTests } from '../lib/stripe.js'
import { startScheduledCoupons } from '../services/coupons.js'
import { api, one, setup, signUp, teardown } from './helpers.js'

/** An in memory stand in for the parts of Stripe the coupons page uses. */
class FakeStripe {
  coupons = new Map<string, any>()
  codes = new Map<string, any>()
  n = 0
  failPromo: any = null
  denyAll = false
  private check() {
    if (this.denyAll) throw Object.assign(new Error('The provided key does not have the required permissions.'), { type: 'StripePermissionError', statusCode: 403 })
  }
  api = {
    coupons: {
      create: async (p: any) => {
        this.check()
        const c = { id: `co_${++this.n}`, valid: true, redeem_by: null, applies_to: null, percent_off: p.percent_off ?? null, amount_off: p.amount_off ?? null, currency: p.currency ?? null, ...p }
        this.coupons.set(c.id, c)
        return c
      },
      del: async (id: string) => {
        this.coupons.delete(id)
        return { id, deleted: true }
      },
    },
    promotionCodes: {
      create: async (p: any) => {
        this.check()
        if (this.failPromo) throw this.failPromo
        if ([...this.codes.values()].some((x) => x.code === p.code && x.active)) {
          throw Object.assign(new Error(`An active promotion code with \`code: ${p.code}\` already exists.`), { type: 'StripeInvalidRequestError', statusCode: 400 })
        }
        const pc = {
          id: `promo_${++this.n}`,
          code: p.code,
          active: p.active ?? true,
          created: Math.floor(Date.now() / 1000) + this.n,
          expires_at: p.expires_at ?? null,
          max_redemptions: p.max_redemptions ?? null,
          times_redeemed: 0,
          metadata: { ...p.metadata },
          restrictions: { first_time_transaction: false, minimum_amount: null, ...p.restrictions },
          promotion: { type: 'coupon', coupon: p.promotion.coupon },
        }
        this.codes.set(pc.id, pc)
        return this.expand(pc)
      },
      list: async (p: any) => {
        this.check()
        const all = [...this.codes.values()].filter((x) => p.active === undefined || x.active === p.active).sort((a, b) => b.created - a.created)
        return { data: all.map((x) => this.expand(x)), has_more: false }
      },
      update: async (id: string, p: any) => {
        this.check()
        const pc = this.codes.get(id)
        if (!pc) throw Object.assign(new Error('No such promotion code'), { type: 'StripeInvalidRequestError', statusCode: 404 })
        if (p.active !== undefined) pc.active = p.active
        if (p.metadata) Object.assign(pc.metadata, p.metadata)
        return this.expand(pc)
      },
    },
  }
  expand(pc: any) {
    return { ...pc, promotion: { ...pc.promotion, coupon: this.coupons.get(pc.promotion.coupon) ?? pc.promotion.coupon } }
  }
}

let fake: FakeStripe
const day = 86400000

describe('Coupons', () => {
  beforeEach(async () => {
    await setup()
    fake = new FakeStripe()
    setStripeForTests(fake.api)
  })
  afterEach(() => setStripeForTests(null))
  after(teardown)

  it('creates a percent code in Stripe with its rules and lists it with usage', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const ends = new Date(Date.now() + 10 * day).toISOString()
    const res = await api('/api/admin/coupons', {
      session: admin,
      body: { code: 'spring20', kind: 'percent', percent_off: 20, ends_at: ends, max_uses: 50, minimum_cents: 2500, first_order_only: true, note: 'Instagram' },
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    assert.equal(res.data.coupon.code, 'SPRING20')
    assert.equal(res.data.coupon.status, 'active')
    const [coupon] = [...fake.coupons.values()]
    assert.equal(coupon.percent_off, 20)
    assert.equal(coupon.duration, 'once')
    const [pc] = [...fake.codes.values()]
    assert.equal(pc.code, 'SPRING20')
    assert.equal(pc.max_redemptions, 50)
    assert.equal(pc.expires_at, Math.floor(Date.parse(ends) / 1000))
    assert.deepEqual(pc.restrictions, { first_time_transaction: true, minimum_amount: 2500, minimum_amount_currency: 'usd' })

    pc.times_redeemed = 3
    const list = await api('/api/admin/coupons', { session: admin })
    assert.equal(list.status, 200)
    assert.equal(list.data.coupons.length, 1)
    assert.equal(list.data.coupons[0].timesUsed, 3)
    assert.equal(list.data.coupons[0].maxUses, 50)
    assert.equal(list.data.coupons[0].note, 'Instagram')
    assert.ok(await one(`select 1 from audit_log where action = 'coupon.created'`))
  })

  it('creates a dollar code and refuses bad input', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const ok = await api('/api/admin/coupons', { session: admin, body: { code: 'TAKE5', kind: 'amount', amount_off_cents: 500 } })
    assert.equal(ok.status, 201)
    assert.equal([...fake.coupons.values()][0].amount_off, 500)
    assert.equal([...fake.coupons.values()][0].currency, 'usd')
    const bad = [
      { code: 'HAS SPACE', kind: 'percent', percent_off: 10 },
      { code: 'X1', kind: 'percent', percent_off: 0 },
      { code: 'X2', kind: 'percent', percent_off: 101 },
      { code: 'X3', kind: 'amount' },
      { code: 'X4', kind: 'percent', percent_off: 10, ends_at: new Date(Date.now() - day).toISOString() },
      { code: 'X5', kind: 'percent', percent_off: 10, starts_at: new Date(Date.now() + 5 * day).toISOString(), ends_at: new Date(Date.now() + 2 * day).toISOString() },
      { code: 'X6', kind: 'amount', amount_off_cents: 1000, minimum_cents: 500 },
    ]
    for (const body of bad) assert.equal((await api('/api/admin/coupons', { session: admin, body })).status, 400, JSON.stringify(body))
    // A duplicate code is explained, and the unused coupon is removed from Stripe.
    const dup = await api('/api/admin/coupons', { session: admin, body: { code: 'take5', kind: 'percent', percent_off: 10 } })
    assert.equal(dup.status, 400)
    assert.match(dup.data.error, /already exists/)
    assert.equal(fake.coupons.size, 1)
  })

  it('only admins can use it', async () => {
    const buyer = await signUp('buyer@example.com')
    assert.equal((await api('/api/admin/coupons', { session: buyer })).status, 403)
    assert.equal((await api('/api/admin/coupons', { session: buyer, body: { code: 'FREE', kind: 'percent', percent_off: 100 } })).status, 403)
    assert.equal(fake.coupons.size, 0)
  })

  it('turns codes off and on, and shows expired and used up codes', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const made = await api('/api/admin/coupons', { session: admin, body: { code: 'WELCOME', kind: 'percent', percent_off: 15 } })
    const id = made.data.coupon.id
    const off = await api(`/api/admin/coupons/${id}/off`, { session: admin, method: 'POST' })
    assert.equal(off.status, 200)
    assert.equal(off.data.coupon.status, 'off')
    assert.equal(fake.codes.get(id).active, false)
    assert.equal((await api(`/api/admin/coupons/${id}/on`, { session: admin, method: 'POST' })).data.coupon.status, 'active')
    assert.equal((await api('/api/admin/coupons/not-a-code/off', { session: admin, method: 'POST' })).status, 400)

    const used = await api('/api/admin/coupons', { session: admin, body: { code: 'TEN', kind: 'percent', percent_off: 10, max_uses: 2 } })
    fake.codes.get(used.data.coupon.id).times_redeemed = 2
    const old = await api('/api/admin/coupons', { session: admin, body: { code: 'OLD', kind: 'percent', percent_off: 10, ends_at: new Date(Date.now() + day).toISOString() } })
    fake.codes.get(old.data.coupon.id).expires_at = Math.floor((Date.now() - 1000) / 1000)
    const list = (await api('/api/admin/coupons', { session: admin })).data.coupons
    const status = Object.fromEntries(list.map((c: any) => [c.code, c.status]))
    assert.deepEqual(status, { WELCOME: 'active', TEN: 'used_up', OLD: 'expired' })
  })

  it('a code with a later start date waits, then starts on time; one turned off by hand stays off', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const start = Date.now() + 3 * day
    const later = await api('/api/admin/coupons', { session: admin, body: { code: 'MOMSDAY', kind: 'percent', percent_off: 25, starts_at: new Date(start).toISOString() } })
    assert.equal(later.data.coupon.status, 'scheduled')
    assert.equal(fake.codes.get(later.data.coupon.id).active, false)
    const other = await api('/api/admin/coupons', { session: admin, body: { code: 'NURSEWEEK', kind: 'percent', percent_off: 25, starts_at: new Date(start).toISOString() } })
    await api(`/api/admin/coupons/${other.data.coupon.id}/off`, { session: admin, method: 'POST' })

    assert.equal(await startScheduledCoupons(Date.now()), 0)
    assert.equal(await startScheduledCoupons(start + 1000), 1)
    assert.equal(fake.codes.get(later.data.coupon.id).active, true)
    assert.equal(fake.codes.get(other.data.coupon.id).active, false)
    assert.equal(await startScheduledCoupons(start + 2000), 0)
  })

  it('explains what to change when the Stripe key lacks permission', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    fake.denyAll = true
    const res = await api('/api/admin/coupons', { session: admin })
    assert.equal(res.status, 503)
    assert.equal(res.data.code, 'stripe_permission')
    assert.match(res.data.error, /Coupons and Promotion codes to Write/)
    assert.doesNotMatch(res.data.error, /[–—]/)
  })

  it('says Stripe is not connected when there are no keys', async () => {
    setStripeForTests(null)
    const admin = await signUp('owner@example.com', 'admin')
    const res = await api('/api/admin/coupons', { session: admin })
    assert.equal(res.status, 503)
    assert.equal(await startScheduledCoupons(), 0)
  })
})
