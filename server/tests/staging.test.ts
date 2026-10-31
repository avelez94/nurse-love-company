import './env.js'
import './staging-env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { db } from '../db/pool.js'
import { latestMigration, migrate } from '../db/migrate.js'
import { LATEST_MIGRATION } from '../db/schema-version.js'
import { deploymentProblems } from '../env.js'
import { api, app, drainOutbox, one, q, setSender, setup, signUp, teardown } from './helpers.js'

beforeEach(setup)
after(teardown)

async function firstAdmin() {
  const owner = await signUp('owner@example.com')
  const r = await api('/api/admin-bootstrap', { session: owner, body: { token: process.env.ADMIN_BOOTSTRAP_TOKEN } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return owner
}

describe('staging access gate', () => {
  it('locks the whole site, dashboards included, but lets webhooks and the health check through', async () => {
    for (const path of ['/', '/api/catalog', '/api/tutorials', '/api/admin/overview', '/api/account/orders']) {
      const res = await app.request(path)
      assert.equal(res.status, 401, path)
      assert.match(res.headers.get('www-authenticate') ?? '', /Basic/)
    }
    const wrong = await app.request('/api/catalog', { headers: { authorization: `Basic ${Buffer.from('nurselove:wrong').toString('base64')}` } })
    assert.equal(wrong.status, 401)
    assert.equal((await api('/api/catalog')).status, 200)

    const health = await api('/api/health', { noGate: true })
    assert.equal(health.status, 200)
    assert.equal(health.data.status, 'ok')
    assert.equal(health.data.environment, 'staging')
    assert.equal(health.data.database, true)
    assert.equal(JSON.stringify(health.data).includes('sk_live'), false, 'no secrets in the health check')

    // Webhooks reach their signature checks (400), not the gate (401).
    for (const hook of ['stripe', 'resend', 'mux']) {
      const res = await api(`/api/webhooks/${hook}`, { noGate: true, body: { fake: true } })
      assert.notEqual(res.status, 401, hook)
    }
    assert.equal((await app.request('/', { headers: { authorization: `Basic ${Buffer.from('nurselove:x').toString('base64')}` } })).headers.get('x-robots-tag'), 'noindex, nofollow')
  })

  it('never takes live payments on staging, even with live keys marked approved', async () => {
    const status = await api('/api/status')
    assert.equal(status.data.payments, 'live-blocked')
    assert.equal(status.data.environment, 'staging')
    const buyer = await signUp('buyer@example.com')
    const p = await one<{ id: string }>(`insert into products (slug, title, category, type, price_cents, status, active) values ('real-thing','Real Thing','np-inserts','digital',900,'published',true) returning id`)
    const res = await api('/api/checkout', { session: buyer, body: { items: [{ productId: p!.id, quantity: 1 }] } })
    assert.equal(res.status, 503)
    assert.equal(res.data.code, 'payments_live_blocked')
  })

  it('reports unsafe hosted settings before start up', () => {
    const problems = deploymentProblems()
    assert.ok(problems.some((p) => p.includes('APP_URL')), 'http APP_URL is rejected on staging')
    assert.ok(problems.some((p) => p.includes('lost on restart')), 'non persistent storage is rejected')
  })
})

describe('first admin', () => {
  it('works once, with the right code, for a signed in account', async () => {
    const someone = await signUp('someone@example.com')
    assert.equal((await api('/api/admin-bootstrap', { body: { token: process.env.ADMIN_BOOTSTRAP_TOKEN } })).status, 401)
    assert.equal((await api('/api/admin-bootstrap', { session: someone, body: { token: 'wrong-wrong-wrong-wrong-wrong' } })).status, 403)
    await firstAdmin()
    const late = await api('/api/admin-bootstrap', { session: someone, body: { token: process.env.ADMIN_BOOTSTRAP_TOKEN } })
    assert.equal(late.status, 409)
    const admins = await q<{ email: string }>(`select email from "user" where role = 'admin'`)
    assert.deepEqual(admins.map((a) => a.email), ['owner@example.com'])
    assert.ok(await one(`select 1 from audit_log where action = 'admin.bootstrapped'`))
  })
})

describe('staging demo content', () => {
  it('loads once, stays labeled, creates no known logins and never duplicates', async () => {
    const owner = await firstAdmin()
    const reviewer = await signUp('mom@example.com')
    assert.equal((await api('/api/admin/demo', { session: reviewer, body: {} })).status, 403, 'customers cannot load demo content')

    const first = await api('/api/admin/demo', { session: owner, body: { reviewer_email: 'mom@example.com' } })
    assert.equal(first.status, 200, JSON.stringify(first.data))
    assert.ok(first.data.productsCreated > 10)
    assert.equal(first.data.reviewerOrdersCreated, 3)
    const counts = async () => one<Record<string, number>>(
      `select (select count(*) from products)::int as products, (select count(*) from orders)::int as orders, (select count(*) from entitlements)::int as entitlements,
              (select count(*) from product_versions)::int as versions, (select count(*) from tutorials)::int as tutorials, (select count(*) from "user")::int as users`,
    )
    const before = await counts()
    const again = await Promise.all([
      api('/api/admin/demo', { session: owner, body: { reviewer_email: 'mom@example.com' } }),
      api('/api/admin/demo', { session: owner, body: { reviewer_email: 'mom@example.com' } }),
    ])
    for (const r of again) assert.deepEqual(r.data, { productsCreated: 0, ordersCreated: 0, reviewerOrdersCreated: 0, tutorialsCreated: 0 })
    assert.deepEqual(await counts(), before)

    // Labeled and separate from real data.
    assert.equal((await one<{ n: number }>(`select count(*)::int as n from orders where not is_demo`))!.n, 0)
    assert.equal((await one<{ n: number }>(`select count(*)::int as n from orders where stripe_payment_intent_id is not null`))!.n, 0)
    const real = await api('/api/admin/overview?demo=0', { session: owner })
    assert.equal(real.data.current.orders, 0)
    const withDemo = await api('/api/admin/overview?demo=1', { session: owner })
    assert.ok(withDemo.data.current.orders > 0)

    // No admin or known password was created; demo shoppers can't receive mail.
    assert.deepEqual((await q<{ email: string }>(`select email from "user" where role = 'admin'`)).map((u) => u.email), ['owner@example.com'])
    assert.equal(await one(`select 1 from "user" where email like '%nurselove.test'`), null)
    const shoppers = await q<{ email: string }>(`select email from "user" where email not in ('owner@example.com','mom@example.com')`)
    assert.ok(shoppers.length > 0 && shoppers.every((s) => s.email.endsWith('@demo.invalid')))

    // The reviewer sees all three download states in her own dashboard.
    const downloads = await api('/api/account/downloads', { session: reviewer })
    const states = downloads.data.downloads.map((d: { status: string }) => d.status).sort()
    assert.deepEqual(states, ['available', 'update_available', 'used'])

    // Demo products can't be bought without Stripe test keys.
    const demoProduct = await one<{ id: string }>(`select id from products where slug = 'glaucoma'`)
    const buy = await api('/api/cart/price', { session: reviewer, body: { items: [{ productId: demoProduct!.id, quantity: 1 }] } })
    assert.equal(buy.status, 400)
    assert.match(buy.data.error, /demo content/)
  })

  it('never sends emails about demo content', async () => {
    const owner = await firstAdmin()
    await api('/api/admin/demo', { session: owner, body: {} })
    const sent: string[] = []
    setSender(async (m) => {
      sent.push(m.to)
      return { id: 'should-not-happen' }
    })
    const order = await one<{ id: string }>(`select o.id from orders o where o.is_demo and o.fulfillment_status = 'unfulfilled' and o.status = 'paid' limit 1`)
    const ship = await api(`/api/admin/orders/${order!.id}/shipments`, { session: owner, body: { carrier: 'USPS', tracking_number: '1', notify: true } })
    assert.equal(ship.status, 201)
    await drainOutbox()
    // The background sender may already be handling it; wait for it to settle.
    let email: { status: string; failure_reason: string } | null = null
    for (let i = 0; i < 40; i++) {
      email = await one<{ status: string; failure_reason: string }>(`select status, failure_reason from emails where related_order_id = $1`, [order!.id])
      if (email && email.status !== 'queued' && email.status !== 'sending') break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.deepEqual(sent, [])
    assert.equal(email!.status, 'suppressed')
    assert.match(email!.failure_reason, /Demo content/)
  })
})

describe('migrations', () => {
  it('are safe to run again and from two instances at once', async () => {
    await Promise.all([migrate(db()), migrate(db())])
    await migrate(db())
    const applied = await q<{ name: string }>('select name from schema_migrations order by name')
    assert.deepEqual(applied.map((r) => r.name), ['001_core.sql', '002_demo_keys.sql', '003_serverless.sql', '004_marketing.sql', '005_quiz_reviews_story_previews.sql', '006_email_automations.sql', '007_update_notifications.sql', '008_freebies_consent.sql', '009_printful.sql', '010_preorders.sql'])
    // The health check compares the database with this constant, so it must name the newest file.
    assert.equal(LATEST_MIGRATION, latestMigration())
    // Supabase's Data API must not see store tables: every public table has row level security on.
    const open = await q(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)
    assert.deepEqual(open, [])
  })
})
