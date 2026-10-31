import './env.js'
import { runUpdateNotifications } from '../services/updates.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import type { Storage } from '../lib/storage.js'
import { setStorage, storage } from '../lib/storage.js'
import {
  addVersion,
  api,
  digitalProduct,
  drainOutbox,
  entitlementsFor,
  one,
  payOrder,
  pendingOrder,
  physicalProduct,
  postResend,
  postStripe,
  q,
  setSender,
  setup,
  signUp,
  stagedUpload,
  stripeEvent,
  teardown,
  checkoutCompleted,
} from './helpers.js'

beforeEach(setup)
after(teardown)

async function boughtDigital(email = 'buyer@example.com') {
  const buyer = await signUp(email)
  const productId = await digitalProduct(email === 'buyer@example.com' ? 'np-test-pages' : `np-${email.split('@')[0]}`)
  const order = await pendingOrder(buyer, [{ productId }])
  await payOrder(order.id, order.subtotal)
  const [ent] = await entitlementsFor(buyer.id)
  return { buyer, productId, order, ent }
}

async function download(session: Awaited<ReturnType<typeof signUp>>, entitlementId: string) {
  const prep = await api(`/api/downloads/${entitlementId}/prepare`, { session, method: 'POST' })
  if (prep.status !== 200) return { prep, deliver: null }
  const deliver = await api(prep.data.url, { session })
  return { prep, deliver }
}

describe('payments', () => {
  it('grants downloads only after a verified successful payment, once, even if the event repeats', async () => {
    const buyer = await signUp('buyer@example.com')
    const productId = await digitalProduct()
    const order = await pendingOrder(buyer, [{ productId }])
    assert.equal((await entitlementsFor(buyer.id)).length, 0, 'pending order has no downloads')

    const event = checkoutCompleted(order.id, order.subtotal)
    assert.equal((await postStripe(event)).data.result, 'processed')
    assert.equal((await postStripe(event)).data.result, 'duplicate')
    assert.equal((await postStripe({ ...event })).data.result, 'duplicate')

    const o = await one<{ status: string; paid_at: string }>('select status, paid_at from orders where id = $1', [order.id])
    assert.equal(o!.status, 'paid')
    const ents = await entitlementsFor(buyer.id)
    assert.equal(ents.length, 1)
    assert.equal(ents[0].status, 'available')
    const emails = await q<{ type: string }>('select type from emails where related_order_id = $1 order by type', [order.id])
    assert.deepEqual(emails.map((e) => e.type), ['digital_available', 'order_confirmation'])
  })

  it('rejects unsigned or wrongly signed webhooks', async () => {
    const buyer = await signUp('buyer@example.com')
    const productId = await digitalProduct()
    const order = await pendingOrder(buyer, [{ productId }])
    const bad = await postStripe(checkoutCompleted(order.id, order.subtotal), 'whsec_wrong_secret')
    assert.equal(bad.status, 400)
    const res = await api('/api/webhooks/stripe', { method: 'POST', body: checkoutCompleted(order.id, order.subtotal) })
    assert.equal(res.status, 400)
    assert.equal((await one<{ status: string }>('select status from orders where id = $1', [order.id]))!.status, 'pending')
    assert.equal((await entitlementsFor(buyer.id)).length, 0)
  })

  it('does not grant downloads for unpaid or failed payments', async () => {
    const buyer = await signUp('buyer@example.com')
    const productId = await digitalProduct()
    const order = await pendingOrder(buyer, [{ productId }])
    const unpaid = await postStripe(checkoutCompleted(order.id, order.subtotal, { payment_status: 'unpaid' }))
    assert.equal(unpaid.data.result, 'ignored')
    await postStripe(stripeEvent('checkout.session.async_payment_failed', { id: 'cs_x', object: 'checkout.session', metadata: { order_id: order.id }, payment_status: 'unpaid' }))
    assert.equal((await one<{ status: string }>('select status from orders where id = $1', [order.id]))!.status, 'failed')
    assert.equal((await entitlementsFor(buyer.id)).length, 0)
  })

  it('digital items are always quantity one and cannot be bought twice', async () => {
    const { buyer, productId } = await boughtDigital()
    const twice = await api('/api/cart/price', { session: buyer, body: { items: [{ productId, quantity: 2 }] } })
    assert.equal(twice.status, 400)
    const again = await api('/api/cart/price', { session: buyer, body: { items: [{ productId, quantity: 1 }] } })
    assert.equal(again.status, 409)
    assert.match(again.data.error, /already own/)
    await assert.rejects(q(`insert into order_items (order_id, product_id, product_type, title_snapshot, unit_price_cents, quantity, line_total_cents) select order_id, product_id, 'digital', 'x', 1, 2, 2 from order_items limit 1`))
  })

  it('checkout says payments are not configured instead of pretending', async () => {
    const buyer = await signUp('buyer@example.com')
    const productId = await digitalProduct()
    const res = await api('/api/checkout', { session: buyer, body: { items: [{ productId, quantity: 1 }] } })
    assert.equal(res.status, 503)
    assert.equal(res.data.code, 'payments_not_configured')
    assert.equal((await one<{ n: number }>('select count(*)::int as n from orders'))!.n, 0)
  })
})

describe('authorization', () => {
  it('keeps every customer inside their own records and admins separate', async () => {
    const { buyer, order, ent } = await boughtDigital()
    const other = await signUp('other@example.com')
    const admin = await signUp('owner@example.com', 'admin')

    assert.equal((await api('/api/account/orders')).status, 401)
    assert.equal((await api(`/api/account/orders/${order.order_number}`, { session: other })).status, 404)
    assert.equal((await api(`/api/account/orders/${order.order_number}/receipt`, { session: other })).status, 404)
    assert.equal((await api(`/api/downloads/${ent.id}/prepare`, { session: other, method: 'POST' })).status, 404)
    assert.equal((await api('/api/account/downloads', { session: other })).data.downloads.length, 0)
    assert.equal((await api(`/api/account/orders/${order.order_number}`, { session: buyer })).status, 200)

    for (const path of ['/api/admin/orders', '/api/admin/customers', '/api/admin/overview', '/api/admin/emails', '/api/admin/settings', '/api/admin/audit']) {
      assert.equal((await api(path, { session: buyer })).status, 403, path)
      assert.equal((await api(path)).status, 401, path)
      assert.equal((await api(path, { session: admin })).status, 200, path)
    }
    // Customers cannot make themselves admins through the sign up API.
    const sneaky = await api('/api/auth/sign-up/email', { body: { email: 'sneaky@example.com', password: 'Correct-Horse-1', name: 'x', role: 'admin' } })
    const role = await one<{ role: string }>('select role from "user" where email = $1', ['sneaky@example.com'])
    assert.ok(sneaky.status >= 400 || role?.role === 'customer')
  })

  it('blocks cross site requests', async () => {
    const buyer = await signUp('buyer@example.com')
    const res = await api('/api/account/support', { session: buyer, body: { subject: 'Hi', message: 'Hello there' }, headers: { origin: 'https://evil.example' } })
    assert.equal(res.status, 403)
  })
})

describe('strict one download rule', () => {
  it('allows the first download and blocks a second redemption', async () => {
    const { buyer, ent } = await boughtDigital()
    // Viewing the dashboard never consumes anything.
    for (let i = 0; i < 3; i++) assert.equal((await api('/api/account/downloads', { session: buyer })).data.downloads[0].statusText, '1 download available')

    const first = await download(buyer, ent.id)
    assert.equal(first.deliver!.status, 200)
    assert.equal(Buffer.from(first.deliver!.data).subarray(0, 5).toString(), '%PDF-')
    assert.match(first.deliver!.headers.get('content-disposition')!, /attachment/)

    const reuse = await api(first.prep.data.url, { session: buyer })
    assert.equal(reuse.status, 410)
    const second = await download(buyer, ent.id)
    assert.equal(second.prep.status, 409)
    assert.equal((await api('/api/account/downloads', { session: buyer })).data.downloads[0].statusText, 'Download used')
    const events = await q<{ event: string }>('select event from download_events where entitlement_id = $1 order by id', [ent.id])
    assert.ok(events.some((e) => e.event === 'delivery_started'))
  })

  it('lets only one of many simultaneous requests succeed', async () => {
    const { buyer, ent } = await boughtDigital()
    const prep = await api(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    const results = await Promise.all(Array.from({ length: 12 }, () => api(prep.data.url, { session: buyer })))
    assert.equal(results.filter((r) => r.status === 200).length, 1)

    // Two different valid tokens racing (for example two tabs) still yield one download.
    const second = await boughtDigital('second@example.com')
    const { hashToken } = await import('../services/entitlements.js')
    await q(`insert into download_tokens (token_hash, entitlement_id, user_id, expires_at) values ($1,$2,$3, now() + interval '1 minute'), ($4,$2,$3, now() + interval '1 minute')`, [hashToken('tab-one-token'), second.ent.id, second.buyer.id, hashToken('tab-two-token')])
    const race = await Promise.all([api('/api/downloads/deliver/tab-one-token', { session: second.buyer }), api('/api/downloads/deliver/tab-two-token', { session: second.buyer })])
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409])
  })

  it('a download link cannot be used by anyone else, even while valid', async () => {
    const { buyer, ent } = await boughtDigital()
    const other = await signUp('other@example.com')
    const prep = await api(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    assert.equal((await api(prep.data.url)).status, 401)
    assert.equal((await api(prep.data.url, { session: other })).status, 404)
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [ent.id]))!.status, 'available')
  })

  it('does not consume the download when file preparation fails', async () => {
    const { buyer, ent } = await boughtDigital()
    const real = storage()
    const broken: Storage = { ...real, size: async () => { throw new Error('storage offline') }, open: async () => { throw new Error('storage offline') }, put: real.put.bind(real), remove: real.remove.bind(real) }
    setStorage(broken)
    try {
      const prep = await api(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
      assert.equal(prep.status, 503)
      assert.match(prep.data.error, /has not been used/)
    } finally {
      setStorage(real)
    }
    // Token issued, then the file becomes unreadable before delivery starts.
    const prep = await api(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    setStorage({ ...broken, size: real.size.bind(real) })
    try {
      assert.equal((await api(prep.data.url, { session: buyer })).status, 503)
    } finally {
      setStorage(real)
    }
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [ent.id]))!.status, 'available')
    // The same link still works once storage is back.
    assert.equal((await api(prep.data.url, { session: buyer })).status, 200)
    const events = (await q<{ event: string }>('select event from download_events where entitlement_id = $1', [ent.id])).map((e) => e.event)
    assert.ok(events.filter((e) => e === 'prepare_failed').length >= 2)
  })

  it('problem reports and audited replacement downloads', async () => {
    const { buyer, ent } = await boughtDigital()
    const admin = await signUp('owner@example.com', 'admin')
    await download(buyer, ent.id)
    const report = await api(`/api/downloads/${ent.id}/report`, { session: buyer, body: { message: 'The file did not save on my phone.' } })
    assert.equal(report.status, 201)
    // A reason is required.
    assert.equal((await api(`/api/admin/order-items/${ent.order_item_id}/replacement-download`, { session: admin, body: { reason: '' } })).status, 400)
    const grant = await api(`/api/admin/order-items/${ent.order_item_id}/replacement-download`, { session: admin, body: { reason: 'Customer reported the download did not save.', report_id: report.data.id } })
    assert.equal(grant.status, 201)
    // No stacking: a second replacement while one is unused is refused.
    assert.equal((await api(`/api/admin/order-items/${ent.order_item_id}/replacement-download`, { session: admin, body: { reason: 'Clicked twice by mistake.' } })).status, 409)
    const list = (await api('/api/account/downloads', { session: buyer })).data.downloads
    assert.equal(list[0].status, 'replacement_available')
    assert.equal((await download(buyer, grant.data.id)).deliver!.status, 200)
    assert.equal((await download(buyer, grant.data.id)).prep.status, 409)
    const auditRow = await one<{ summary: string }>(`select summary from audit_log where action = 'download.replacement_granted'`)
    assert.match(auditRow!.summary, /Reason: Customer reported/)
    assert.equal((await one<{ status: string }>('select status from download_problem_reports where id = $1', [report.data.id]))!.status, 'resolved')
  })
})

describe('product versions', () => {
  it('a new release grants exactly one new download per purchaser, never stacking, and retries are safe', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const productId = await digitalProduct()
    const a = await signUp('a@example.com')
    const b = await signUp('b@example.com')
    for (const u of [a, b]) {
      const o = await pendingOrder(u, [{ productId }])
      await payOrder(o.id, o.subtotal)
    }
    const aEnt = (await entitlementsFor(a.id))[0]
    await download(a, aEnt.id) // a used v1, b did not

    const impact = await api(`/api/admin/products/${productId}/release-impact`, { session: admin })
    assert.deepEqual(impact.data, { items: 2, customers: 2 })

    const uploadId = await stagedUpload(productId, 2)
    const body = { upload_id: uploadId, notes: 'Fixed a typo on page 2.', notify: true, idempotency_key: 'release-key-0001', confirm: true }
    const first = await api(`/api/admin/products/${productId}/releases`, { session: admin, body })
    assert.equal(first.status, 201)
    assert.equal(first.data.granted_count, 2)
    // Retried request (double click, network retry): no new grants, no new emails.
    const retry = await api(`/api/admin/products/${productId}/releases`, { session: admin, body })
    assert.equal(retry.status, 200)
    assert.equal(retry.data.duplicate, true)

    for (const u of [a, b]) {
      const ents = await entitlementsFor(u.id)
      assert.equal(ents.filter((e) => e.status === 'available').length, 1, 'exactly one available download')
    }
    const bEnts = await entitlementsFor(b.id)
    assert.equal(bEnts.find((e) => e.source === 'purchase')!.status, 'superseded', 'unused v1 is replaced, not stacked')
    // Only the customer who downloaded the older version is emailed.
    // Resend is not configured in these tests, so the notice is held (kept, not faked as sent).
    await runUpdateNotifications()
    const notices = await q<{ email: string; status: string }>('select u.email, n.status from update_notifications n join "user" u on u.id = n.user_id')
    assert.deepEqual(notices, [{ email: 'a@example.com', status: 'held' }])
    assert.equal((await q('select 1 from emails where type = $1', ['product_update'])).length, 0)

    // The new download delivers version 2, and only once.
    const aNew = (await entitlementsFor(a.id)).find((e) => e.status === 'available')!
    const got = await download(a, aNew.id)
    assert.equal(got.deliver!.status, 200)
    assert.equal(got.deliver!.headers.get('content-disposition'), 'attachment; filename="staged-2.pdf"')
    assert.equal((await download(a, aNew.id)).prep.status, 409)
    // The old consumed version is not restored.
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [aEnt.id]))!.status, 'redeemed')
    assert.equal((await api('/api/account/downloads', { session: b })).data.downloads[0].statusText, 'Updated version available • 1 new download')

    // Versions are immutable.
    await assert.rejects(q(`update product_versions set notes = 'changed' where product_id = $1`, [productId]))
    assert.ok(await one(`select 1 from audit_log where action = 'product.version_released'`))
  })

  it('listing edits, email resends and password resets never grant downloads', async () => {
    const { buyer, productId, order, ent } = await boughtDigital()
    const admin = await signUp('owner@example.com', 'admin')
    await download(buyer, ent.id)
    const before = await entitlementsFor(buyer.id)

    const detail = await api(`/api/admin/products/${productId}`, { session: admin })
    const p = detail.data.product
    const edit = await api(`/api/admin/products/${productId}`, {
      session: admin,
      method: 'PUT',
      body: { ...p, title: 'Renamed product', price_cents: 1500, short_description: 'Typo fixed', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New words', marks: [{ type: 'bold' }] }] }] } },
    })
    assert.equal(edit.status, 200, JSON.stringify(edit.data))

    const email = await one<{ id: string }>('select id from emails where related_order_id = $1 and type = $2', [order.id, 'digital_available'])
    const r1 = await api(`/api/admin/emails/${email!.id}/resend`, { session: admin, body: { idempotency_key: 'resend-click-1234' } })
    const r2 = await api(`/api/admin/emails/${email!.id}/resend`, { session: admin, body: { idempotency_key: 'resend-click-1234' } })
    assert.equal(r1.data.id, r2.data.id, 'repeated clicks create one email')
    assert.equal(r2.data.duplicate, true)
    const resent = await one<{ resent_from_id: string; resent_by: string }>('select resent_from_id, resent_by from emails where id = $1', [r1.data.id])
    assert.equal(resent!.resent_from_id, email!.id)
    assert.equal(resent!.resent_by, 'owner@example.com')

    await api('/api/auth/request-password-reset', { body: { email: buyer.email, redirectTo: 'http://localhost:5173/#reset-password' } })
    assert.ok(await one(`select 1 from emails where type = 'password_reset' and to_email = $1`, [buyer.email]))

    assert.deepEqual(await entitlementsFor(buyer.id), before)
    assert.equal((await download(buyer, ent.id)).prep.status, 409)
  })
})

describe('products and orders', () => {
  it('inactive and archived products leave the shop but keep history and downloads', async () => {
    const { buyer, productId, order, ent } = await boughtDigital()
    const admin = await signUp('owner@example.com', 'admin')
    await api(`/api/admin/products/${productId}/archive`, { session: admin, method: 'POST' })
    const catalog = await api('/api/catalog')
    assert.equal(catalog.data.products.length, 0)
    assert.equal((await api('/api/products/np-test-pages')).status, 404)
    const other = await signUp('other@example.com')
    assert.equal((await api('/api/cart/price', { session: other, body: { items: [{ productId, quantity: 1 }] } })).status, 400)
    assert.equal((await api(`/api/account/orders/${order.order_number}`, { session: buyer })).status, 200)
    assert.equal((await download(buyer, ent.id)).deliver!.status, 200)
    assert.equal((await one<{ n: number }>('select count(*)::int as n from orders'))!.n, 1)
  })

  it('drafts stay private until published', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const created = await api('/api/admin/products', { session: admin, body: { title: 'New Planner', slug: 'new-planner', category: 'nurse-inserts', type: 'digital', price_cents: 800, description: { type: 'doc', content: [] } } })
    assert.equal(created.status, 201)
    assert.equal((await api('/api/products/new-planner')).status, 404)
    assert.equal((await api(`/api/admin/products/${created.data.id}/preview`, { session: admin })).status, 200)
    await api(`/api/admin/products/${created.data.id}/publish`, { session: admin, method: 'POST' })
    assert.equal((await api('/api/products/new-planner')).status, 200)
  })

  it('sanitizes rich text descriptions', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const evil = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'fontStyle', attrs: { font: 'Comic Sans' } }, { type: 'bold' }] }] },
        { type: 'image', attrs: { src: 'x' } },
        { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      ],
    }
    const created = await api('/api/admin/products', { session: admin, body: { title: 'Rich', slug: 'rich', category: 'other', type: 'digital', description: evil } })
    const row = await one<{ description: { content: Array<{ content: Array<{ marks?: unknown[]; text: string }> }> } }>('select description from products where id = $1', [created.data.id])
    assert.equal(row!.description.content.length, 2)
    assert.deepEqual(row!.description.content[0].content[0].marks, [{ type: 'bold' }])
    assert.equal(row!.description.content[1].content[0].text, '<script>alert(1)</script>', 'kept as plain text, never markup')
  })

  it('handles mixed orders, shipping updates and receipt snapshots', async () => {
    const buyer = await signUp('buyer@example.com')
    const admin = await signUp('owner@example.com', 'admin')
    const digitalId = await digitalProduct()
    const teeId = await physicalProduct('test-tee', 5)
    const order = await pendingOrder(buyer, [{ productId: digitalId }, { productId: teeId, quantity: 2 }])
    await payOrder(order.id, order.subtotal, { collected_information: { shipping_details: { name: 'Test Person', address: { line1: '1 Ship St', city: 'Shipton', state: 'NC', postal_code: '27601', country: 'US' } } } })
    const ents = await entitlementsFor(buyer.id)
    assert.equal(ents.length, 1, 'only the digital line gets a download')
    assert.equal((await one<{ inventory_quantity: number }>('select inventory_quantity from products where id = $1', [teeId]))!.inventory_quantity, 5, 'Printful makes physical items: no local stock is used')
    assert.ok(await one('select 1 from printful_orders where order_id = $1', [order.id]), 'the physical items are queued for Printful')
    const manual = await api(`/api/admin/orders/${order.id}/shipments`, { session: admin, body: { carrier: 'USPS', tracking_number: 'X', notify: false } })
    assert.equal(manual.status, 409, 'Printful orders cannot be marked shipped by hand')
    // The rest covers an order from before Printful, shipped by hand.
    await q('delete from printful_orders where order_id = $1', [order.id])

    // Address book changes never rewrite the order.
    await api('/api/account/addresses', { session: buyer, body: { name: 'New Name', line1: '9 New Rd', city: 'Elsewhere', postal_code: '10001', country: 'US' } })
    const ship = await api(`/api/admin/orders/${order.id}/shipments`, { session: admin, body: { carrier: 'USPS', tracking_number: '9400TEST', tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400TEST', notify: true } })
    assert.equal(ship.status, 201)

    // Listing changes never rewrite receipts.
    await q(`update products set title = 'Renamed Tee', price_cents = 9900 where id = $1`, [teeId])
    const detail = await api(`/api/account/orders/${order.order_number}`, { session: buyer })
    assert.equal(detail.data.shipments[0].tracking_number, '9400TEST')
    assert.equal(detail.data.order.shipping_address.address.line1, '1 Ship St')
    assert.equal(detail.data.order.fulfillment_status, 'fulfilled')
    const receipt = await api(`/api/account/orders/${order.order_number}/receipt`, { session: buyer })
    assert.match(receipt.data, /Test test-tee/)
    assert.doesNotMatch(receipt.data, /Renamed Tee/)
    assert.match(receipt.data, /\$25\.00/)
    assert.ok(await one(`select 1 from emails where type = 'shipping_confirmation' and related_order_id = $1`, [order.id]))
    assert.ok(await one(`select 1 from audit_log where action = 'order.fulfilled' and entity_id = $1`, [order.id]))
  })

  it('refunds from Stripe update the order and revoke unused downloads under the default policy', async () => {
    const { buyer, order, ent } = await boughtDigital()
    const pi = `pi_test_${order.id.slice(0, 8)}`
    const res = await postStripe(stripeEvent('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: pi, amount_refunded: order.subtotal, refunds: { data: [{ id: 're_1', amount: order.subtotal, status: 'succeeded', reason: 'requested_by_customer' }] } }))
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal((await one<{ status: string }>('select status from orders where id = $1', [order.id]))!.status, 'refunded')
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [ent.id]))!.status, 'revoked')
    assert.equal((await download(buyer, ent.id)).prep.status, 403)
    assert.equal((await api('/api/account/downloads', { session: buyer })).data.downloads[0].status, 'unavailable')
  })

  it('reports keep shipping and tax separate from product sales', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const { order } = await boughtDigital()
    await q('update orders set shipping_cents = 500, tax_cents = 72, total_cents = total_cents + 572 where id = $1', [order.id])
    const r = await api('/api/admin/overview', { session: admin })
    assert.equal(r.data.current.grossSales, 1200)
    assert.equal(r.data.current.shipping, 500)
    assert.equal(r.data.current.taxes, 72)
    assert.equal(r.data.current.netSales, 1200)
    assert.equal(r.data.current.orders, 1)
    assert.equal(r.data.current.newCustomers, 1)
    const csv = await api('/api/admin/reports/orders.csv', { session: admin })
    assert.match(csv.data, /Order,Created,Paid/)
  })
})

describe('email center', () => {
  it('records delivery events from verified Resend webhooks and suppresses bounces', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const sent: string[] = []
    setSender(async (m) => {
      sent.push(m.to)
      return { id: `re_${sent.length}` }
    })
    const { order } = await boughtDigital()
    await drainOutbox()
    assert.equal(sent.length, 2)
    const email = await one<{ id: string; resend_id: string; status: string }>('select id, resend_id, status from emails where related_order_id = $1 and type = $2', [order.id, 'order_confirmation'])
    assert.equal(email!.status, 'sent')

    const delivered = { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: email!.resend_id, to: ['buyer@example.com'] } }
    assert.equal((await postResend(delivered, 'msg_1')).data.result, 'processed')
    assert.equal((await postResend(delivered, 'msg_1')).data.result, 'duplicate')
    const bounced = { type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: email!.resend_id, bounce: { message: 'Mailbox does not exist' } } }
    await postResend(bounced, 'msg_2')
    const after = await one<{ status: string; delivered_at: string; bounced_at: string }>('select status, delivered_at, bounced_at from emails where id = $1', [email!.id])
    assert.equal(after!.status, 'bounced')
    assert.ok(after!.delivered_at && after!.bounced_at)

    const res = await api(`/api/admin/emails/${email!.id}/resend`, { session: admin, body: { idempotency_key: 'resend-after-bounce' } })
    assert.equal(res.status, 409, 'suppressed addresses are not emailed')

    const forged = await api('/api/webhooks/resend', { method: 'POST', body: delivered, headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' } })
    assert.equal(forged.status, 400)
    const detail = await api(`/api/admin/emails/${email!.id}`, { session: admin })
    assert.equal(detail.data.events.length, 2)
    assert.match(detail.data.email.html, /Thank you for your order/)
  })

  it('without Resend configured, emails are logged as not sent rather than faked', async () => {
    await boughtDigital()
    // A background send started by the payment may still hold rows; wait until none are in flight.
    for (let i = 0; i < 50; i++) {
      await drainOutbox()
      if (!(await q(`select 1 from emails where status in ('queued','sending')`)).length) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const rows = await q<{ status: string }>('select status from emails')
    assert.ok(rows.length > 0)
    assert.ok(rows.every((r) => r.status === 'not_configured'))
  })
})

describe('tutorials', () => {
  async function tutorialDraft(admin: Awaited<ReturnType<typeof signUp>>) {
    const res = await api('/api/admin/tutorials', { session: admin, body: { title: 'How to Put Together Your NP Binder', slug: 'np-binder', category: 'np-binder', summary: 'Test', instructions: { type: 'doc', content: [] } } })
    assert.equal(res.status, 201)
    return res.data.id as string
  }

  it('uploads and processes a video, keeps drafts private, and publishes on demand', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await tutorialDraft(admin)
    const { readFileSync } = await import('node:fs')
    const video = readFileSync('src/assets/tutorials/placeholder.mp4')
    const up = await api(`/api/admin/tutorials/${id}/video`, { session: admin, method: 'PUT', body: video, headers: { 'content-type': 'video/mp4', 'x-file-name': 'np-binder.mp4' } })
    assert.equal(up.status, 202, JSON.stringify(up.data))
    let status = ''
    for (let i = 0; i < 60 && status !== 'ready' && status !== 'errored'; i++) {
      await new Promise((r) => setTimeout(r, 250))
      status = (await one<{ video_status: string }>('select video_status from tutorials where id = $1', [id]))!.video_status
    }
    assert.equal(status, 'ready')
    const t = await one<{ duration_seconds: number }>('select duration_seconds from tutorials where id = $1', [id])
    assert.ok(t!.duration_seconds > 10)

    // Draft: invisible publicly, playable in admin preview.
    assert.equal((await api('/api/tutorials')).data.tutorials.length, 0)
    assert.equal((await api('/api/tutorials/np-binder')).status, 404)
    assert.equal((await api('/api/tutorials/np-binder/video')).status, 404)
    assert.equal((await api(`/api/admin/tutorials/${id}/preview/video`, { session: admin })).status, 200)

    await api(`/api/admin/tutorials/${id}/captions`, { session: admin, method: 'PUT', body: { label: 'English', srclang: 'en', vtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello' } })
    await api(`/api/admin/tutorials/${id}/publish`, { session: admin, method: 'POST' })

    // Public, no account needed.
    const pub = await api('/api/tutorials/np-binder')
    assert.equal(pub.status, 200)
    assert.equal(pub.data.tutorial.captions[0].srclang, 'en')
    const range = await api('/api/tutorials/np-binder/video', { headers: { range: 'bytes=0-99' } })
    assert.equal(range.status, 206)
    assert.equal((await api('/api/tutorials/np-binder/captions/en')).status, 200)

    await api(`/api/admin/tutorials/${id}/unpublish`, { session: admin, method: 'POST' })
    assert.equal((await api('/api/tutorials/np-binder/video')).status, 404)
    assert.equal((await api('/api/tutorials/np-binder/captions/en')).status, 404)
  })

  it('a failed upload keeps the draft and reports a clear error', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await tutorialDraft(admin)
    const fake = Buffer.from('this is not really a video file at all')
    const res = await api(`/api/admin/tutorials/${id}/video`, { session: admin, method: 'PUT', body: fake, headers: { 'content-type': 'video/mp4', 'x-file-name': 'clip.mp4' } })
    assert.equal(res.status, 415)
    const t = await one<{ title: string; status: string; video_status: string; video_error: string }>('select title, status, video_status, video_error from tutorials where id = $1', [id])
    assert.equal(t!.title, 'How to Put Together Your NP Binder')
    assert.equal(t!.status, 'draft')
    assert.match(t!.video_error, /not supported/)
    const uploads = await q<{ status: string }>('select status from video_uploads where tutorial_id = $1', [id])
    assert.equal(uploads[0].status, 'failed')
    assert.equal((await api(`/api/admin/tutorials/${id}/publish`, { session: admin, method: 'POST' })).status, 400, 'cannot publish without a playable video')
    assert.equal((await api(`/api/admin/tutorials/${id}/video`, { session: admin, method: 'PUT', body: fake, headers: { 'content-type': 'application/pdf', 'x-file-name': 'x.pdf' } })).status, 415)
  })

  it('hosted links are validated, and watching tutorials never touches downloads', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const { buyer, ent } = await boughtDigital()
    const id = await tutorialDraft(admin)
    assert.equal((await api(`/api/admin/tutorials/${id}/embed`, { session: admin, method: 'PUT', body: { url: 'https://evil.example/video' } })).status, 400)
    const ok = await api(`/api/admin/tutorials/${id}/embed`, { session: admin, method: 'PUT', body: { url: 'https://youtu.be/dQw4w9WgXcQ' } })
    assert.equal(ok.data.embed_url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0')
    await api(`/api/admin/tutorials/${id}/publish`, { session: admin, method: 'POST' })
    const before = await entitlementsFor(buyer.id)
    for (let i = 0; i < 5; i++) {
      await api('/api/tutorials')
      await api('/api/tutorials/np-binder', { session: buyer })
    }
    assert.deepEqual(await entitlementsFor(buyer.id), before)
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [ent.id]))!.status, 'available')
  })
})

describe('audit history', () => {
  it('records important admin actions', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const productId = await digitalProduct()
    await api(`/api/admin/products/${productId}/deactivate`, { session: admin, method: 'POST' })
    await api('/api/admin/settings/shipping', { session: admin, method: 'PUT', body: { configured: true, flat_rate_cents: 500 } })
    const log = await api('/api/admin/audit', { session: admin })
    const actions = log.data.entries.map((e: { action: string }) => e.action)
    assert.ok(actions.includes('product.deactivate'))
    assert.ok(actions.includes('settings.updated'))
    await assert.rejects(q('delete from audit_log'), /immutable/)
  })
})
