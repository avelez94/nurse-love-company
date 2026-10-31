import './env.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, beforeEach, describe, it } from 'node:test'
import { runAutomations } from '../services/automations.js'
import { ingestDeliveryEvent } from '../services/delivery.js'
import { requeueStalled } from '../email/outbox.js'
import { api, digitalProduct, drainOutbox, entitlementsFor, one, payOrder, pendingOrder, physicalProduct, postStripe, q, setSender, setup, signUp, stripeEvent, teardown, type Session } from './helpers.js'

const DAY = 86_400_000
const sent: Array<{ to: string; subject: string; html: string; text: string }> = []
const capture = () => {
  sent.length = 0
  setSender(async (m) => {
    sent.push(m)
    return { id: `re_${sent.length}_${Date.now()}` }
  })
}
const at = (paidAt: Date, days: number, minutes = 1) => new Date(paidAt.getTime() + days * DAY + minutes * 60_000)
async function run(now: Date) {
  const r = await runAutomations({ now })
  await settle()
  return r
}
async function enable(admin: Session, kind: string, enabled = true, delay?: number) {
  const r = await api(`/api/admin/automations/${kind}`, { session: admin, method: 'PUT', body: { enabled, ...(delay ? { delay_days: delay } : {}) } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data
}
/** Waits until the outbox is idle (payment confirmations are sent in the background). */
async function settle() {
  for (let i = 0; i < 50; i++) {
    await drainOutbox()
    if (!(await one(`select 1 from emails where status in ('queued','sending')`))) return
    await new Promise((r) => setTimeout(r, 20))
  }
}
/** A paid order, moved 60 days into the past so delivery dates can be real past times. Receipts it sends are not counted. */
async function paidOrder(user: Session, productIds: string[]) {
  const o = await pendingOrder(user, productIds.map((productId) => ({ productId })))
  await payOrder(o.id, o.subtotal)
  await q(`update orders set paid_at = paid_at - interval '60 days' where id = $1`, [o.id])
  await q(`update email_jobs set start_at = start_at - interval '60 days', due_at = due_at - interval '60 days' where order_id = $1`, [o.id])
  await settle()
  sent.length = 0
  const paid = await one<{ paid_at: Date }>('select paid_at from orders where id = $1', [o.id])
  return { ...o, paidAt: new Date(paid!.paid_at) }
}
const jobs = (orderId: string) => q<{ kind: string; status: string; hold_reason: string; status_reason: string; product_id: string; due_at: Date | null }>('select kind, status, hold_reason, status_reason, product_id, due_at from email_jobs where order_id = $1 order by kind, product_id', [orderId])
async function shipment(admin: Session, orderId: string, items?: Array<{ order_item_id: string; quantity: number }>, tracking = 'TRACK1') {
  const r = await api(`/api/admin/orders/${orderId}/shipments`, { session: admin, body: { carrier: 'USPS', tracking_number: tracking, notify: false, items } })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  return r.data.id as string
}
const entSnapshot = async (userId: string) => JSON.stringify((await entitlementsFor(userId)).map((e) => [e.id, e.status]))

describe('email automations', () => {
  beforeEach(async () => {
    await setup()
    capture()
  })
  after(teardown)

  it('are switched off by default, and purchases from before switching on are never emailed', async () => {
    const buyer = await signUp('early@example.com')
    const p = await digitalProduct('np-early')
    const o = await paidOrder(buyer, [p])
    assert.equal((await jobs(o.id)).length, 0)
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    await enable(admin, 'digital_review')
    await run(at(o.paidAt, 30))
    assert.equal(sent.length, 0, 'no backlog of historical customers')
  })

  it('download reminder: three days after payment, unused available items only, one per item, entitlements untouched', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('reminder@example.com', 'customer', 'Casey Nurse')
    const a = await digitalProduct('np-a')
    const b = await digitalProduct('np-b')
    const o = await paidOrder(buyer, [a, b])
    const js = await jobs(o.id)
    assert.equal(js.length, 2)
    assert.ok(js.every((j) => j.status === 'scheduled' && Math.abs(new Date(j.due_at!).getTime() - (o.paidAt.getTime() + 3 * DAY)) < 1000), 'due three days after the confirmed payment')

    // The customer downloads B before the reminder is due.
    const itemB = await one<{ id: string }>('select id from order_items where order_id = $1 and product_id = $2', [o.id, b])
    await q(`update entitlements set status = 'redeemed', redeemed_at = now() where order_item_id = $1`, [itemB!.id])
    const before = await entSnapshot(buyer.id)

    await run(at(o.paidAt, 2, 59 * 24))
    assert.equal(sent.length, 0, 'not before it is due')
    await run(at(o.paidAt, 3))
    assert.equal(sent.length, 1, 'one combined email')
    const m = sent[0]
    assert.equal(m.to, 'reminder@example.com')
    assert.match(m.subject, /Your nursing goodies are waiting/)
    assert.ok(m.html.includes('Test np-a') && !m.html.includes('Test np-b'), 'only the undownloaded item')
    assert.ok(m.html.includes('/#account-downloads'), 'links to My downloads')
    assert.ok(!/\/api\/downloads|deliver|token=/.test(m.html), 'never a file or redemption link')
    assert.match(m.text, /Each purchase includes one download/)
    assert.ok(!/expire/i.test(m.text), 'does not imply downloads expire')
    assert.match(m.html, /email-preferences\?t=/, 'has a preference link')
    assert.equal(await entSnapshot(buyer.id), before, 'the reminder never grants, resets or uses a download')
    const states = await jobs(o.id)
    assert.deepEqual(states.map((j) => j.status).sort(), ['sent', 'skipped'])
    assert.ok(states.some((j) => j.status_reason === 'Already downloaded.'))

    // Repeated runs, a repeated payment event and a product update send nothing more.
    await run(at(o.paidAt, 10))
    await payOrder(o.id, o.subtotal)
    await settle()
    await run(at(o.paidAt, 11))
    assert.equal(sent.length, 1)
    assert.equal((await q('select 1 from email_jobs where order_id = $1', [o.id])).length, 2)

    // Viewing the downloads page (where the email leads) uses nothing.
    assert.equal((await api('/api/account/downloads', { session: buyer })).status, 200)
    assert.equal(await entSnapshot(buyer.id), before)
  })

  it('download reminder skips revoked, fully refunded, disputed and demo purchases, rechecked at send time', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('skips@example.com')
    const p1 = await digitalProduct('np-r1')
    const o1 = await paidOrder(buyer, [p1])
    await q(`update entitlements set status = 'revoked' where user_id = $1`, [buyer.id])
    const buyer2 = await signUp('refund@example.com')
    const p2 = await digitalProduct('np-r2')
    const o2 = await paidOrder(buyer2, [p2])
    await q(`update order_items set refunded_quantity = quantity where order_id = $1`, [o2.id])
    await q(`update orders set status = 'partially_refunded' where id = $1`, [o2.id])
    const buyer3 = await signUp('dispute@example.com')
    const p3 = await digitalProduct('np-r3')
    const o3 = await paidOrder(buyer3, [p3])
    await q(`update orders set status = 'disputed' where id = $1`, [o3.id])
    await run(at(o3.paidAt, 3))
    assert.equal(sent.length, 0)
    assert.equal((await jobs(o1.id))[0].status_reason, 'The download was revoked.')
    assert.equal((await jobs(o2.id))[0].status_reason, 'This item was fully refunded.')
    assert.equal((await jobs(o3.id))[0].status_reason, 'The payment is disputed.')

    const demo = await signUp('demo@example.com')
    const pd = await digitalProduct('np-demo')
    const od = await pendingOrder(demo, [{ productId: pd }])
    await q('update orders set is_demo = true where id = $1', [od.id])
    await payOrder(od.id, od.subtotal)
    assert.equal((await jobs(od.id)).length, 0, 'demo or test purchases are never scheduled')
  })

  it('digital review request: seven days after payment, grouped per order, skips products already reviewed, one per customer and product', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'digital_review')
    const buyer = await signUp('reviewer@example.com', 'customer', 'Riley')
    const a = await digitalProduct('np-ra')
    const b = await digitalProduct('np-rb')
    const c = await digitalProduct('np-rc')
    const o = await paidOrder(buyer, [a, b, c])
    // Downloading does not matter for review requests.
    await q(`update entitlements set status = 'redeemed' where user_id = $1`, [buyer.id])
    const review = await api(`/api/account/reviews/${c}`, { session: buyer, method: 'PUT', body: { rating: 5, title: 'Lovely', body: 'Exactly what I needed.', display_name: 'Riley' } })
    assert.equal(review.status, 200)
    const before = await entSnapshot(buyer.id)
    await run(at(o.paidAt, 6, 23 * 60))
    assert.equal(sent.length, 0)
    await run(at(o.paidAt, 7))
    assert.equal(sent.length, 1)
    const m = sent[0]
    assert.ok(m.html.includes(`/#account-review-${a}`) && m.html.includes(`/#account-review-${b}`), 'a Leave a review button for each product')
    assert.ok(!m.html.includes(`/#account-review-${c}`), 'not for the product already reviewed')
    assert.match(m.text, /honestly/)
    assert.ok(!/discount|coupon|gift card|reward you/i.test(m.text), 'no incentives')
    assert.equal(await entSnapshot(buyer.id), before)

    // Buying the same product again never brings a second request.
    await q(`delete from entitlements where user_id = $1`, [buyer.id])
    await q(`delete from email_jobs where kind = 'download_reminder'`)
    const again = await one<{ id: string; subtotal: number }>(`insert into orders (user_id, email, status, subtotal_cents, total_cents) values ($1,$2,'pending',1200,1200) returning id, subtotal_cents as subtotal`, [buyer.id, buyer.email])
    await q(`insert into order_items (order_id, product_id, product_type, title_snapshot, unit_price_cents, quantity, line_total_cents) values ($1,$2,'digital','Test np-ra',1200,1,1200)`, [again!.id, a])
    await payOrder(again!.id, 1200)
    await settle()
    sent.length = 0
    await run(at(o.paidAt, 30))
    assert.equal(sent.length, 0, 'no second review request')
    assert.equal((await q(`select 1 from email_jobs where kind = 'digital_review' and product_id = $1`, [a])).length, 1)
  })

  it('physical review request: 14 days after confirmed delivery only; missing, late, duplicate and out of order events', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'physical_review')
    const buyer = await signUp('tee@example.com')
    const tee = await physicalProduct('tee-1')
    const o = await paidOrder(buyer, [tee])
    let [job] = await jobs(o.id)
    assert.equal(job.status, 'held')
    assert.equal(job.hold_reason, 'awaiting_delivery')
    const sh = await shipment(admin, o.id)
    await run(at(o.paidAt, 60))
    assert.equal(sent.length, 0, 'shipped is not delivered; nothing is sent from purchase or shipment dates')

    const deliveredAt = new Date(o.paidAt.getTime() + 5 * DAY)
    // Events arrive late and out of order: delivered first, then an older in transit event.
    assert.equal(await ingestDeliveryEvent({ source: 'carrier', eventId: 'e2', trackingNumber: 'TRACK1', status: 'delivered', occurredAt: deliveredAt.toISOString() }), 'applied')
    assert.equal(await ingestDeliveryEvent({ source: 'carrier', eventId: 'e2', trackingNumber: 'TRACK1', status: 'delivered', occurredAt: deliveredAt.toISOString() }), 'duplicate')
    assert.equal(await ingestDeliveryEvent({ source: 'carrier', eventId: 'e1', trackingNumber: 'TRACK1', status: 'in_transit', occurredAt: new Date(deliveredAt.getTime() - DAY).toISOString() }), 'ignored')
    assert.equal(await ingestDeliveryEvent({ source: 'carrier', eventId: 'e3', trackingNumber: 'TRACK1', status: 'delivered', occurredAt: new Date(deliveredAt.getTime() + DAY).toISOString() }), 'ignored')
    const s = await one<{ status: string; delivered_at: Date }>('select status, delivered_at from shipments where id = $1', [sh])
    assert.equal(s!.status, 'delivered')
    assert.equal(new Date(s!.delivered_at).getTime(), deliveredAt.getTime(), 'the actual delivery time, never moved')
    ;[job] = await jobs(o.id)
    assert.equal(job.status, 'scheduled')
    assert.equal(new Date(job.due_at!).getTime(), deliveredAt.getTime() + 14 * DAY)

    await run(at(deliveredAt, 13, 23 * 60))
    assert.equal(sent.length, 0)
    // Overdue (the processor was down): goes out on the next run.
    await run(at(deliveredAt, 40))
    assert.equal(sent.length, 1)
    assert.ok(sent[0].html.includes(`/#account-review-${tee}`))
    await run(at(deliveredAt, 41))
    assert.equal(sent.length, 1)
  })

  it('split shipments schedule each item from its own delivery; the owner can record a delivery date with a reason; problems hold requests', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'physical_review')
    const buyer = await signUp('split@example.com')
    const tee = await physicalProduct('tee-split')
    const pen = await physicalProduct('pen-split')
    const mug = await physicalProduct('mug-split')
    const o = await paidOrder(buyer, [tee, pen, mug])
    const items = await q<{ id: string; product_id: string }>('select id, product_id from order_items where order_id = $1', [o.id])
    const id = (p: string) => items.find((i) => i.product_id === p)!.id
    const shA = await shipment(admin, o.id, [{ order_item_id: id(tee), quantity: 1 }, { order_item_id: id(pen), quantity: 1 }], 'TA')
    const shB = await shipment(admin, o.id, [{ order_item_id: id(mug), quantity: 1 }], 'TB')

    const dA = new Date(o.paidAt.getTime() + 3 * DAY)
    // Recording needs a reason, may not be in the future, and is audited.
    assert.equal((await api(`/api/admin/shipments/${shA}/delivery`, { session: admin, body: { delivered_at: dA.toISOString(), reason: '' } })).status, 400)
    assert.equal((await api(`/api/admin/shipments/${shA}/delivery`, { session: admin, body: { delivered_at: new Date(Date.now() + 3 * DAY).toISOString(), reason: 'Carrier site shows delivered' } })).status, 400)
    assert.equal((await api(`/api/admin/shipments/${shA}/delivery`, { session: buyer, body: { delivered_at: dA.toISOString(), reason: 'Carrier site shows delivered' } })).status, 403)
    assert.equal((await api(`/api/admin/shipments/${shA}/delivery`, { session: admin, body: { delivered_at: dA.toISOString(), reason: 'Carrier site shows delivered' } })).status, 200)
    const log = await one<{ summary: string }>(`select summary from audit_log where action = 'shipment.delivery_recorded' and entity_id = $1`, [o.id])
    assert.match(log!.summary, /Carrier site shows delivered/)
    // The quick status menu cannot mark delivered without a date and reason.
    assert.equal((await api(`/api/admin/shipments/${shB}`, { session: admin, method: 'PATCH', body: { status: 'delivered' } })).status, 400)

    // Shipment B has a problem: its request is held with the reason.
    assert.equal((await api(`/api/admin/shipments/${shB}`, { session: admin, method: 'PATCH', body: { status: 'exception', problem: 'Returned to sender' } })).status, 200)
    const held = (await jobs(o.id)).find((j) => j.product_id === mug)!
    assert.equal(held.hold_reason, 'delivery_problem')
    assert.match(held.status_reason, /Returned to sender/)

    await run(at(dA, 14))
    assert.equal(sent.length, 1, 'tee and pen delivered together: one email')
    assert.ok(sent[0].html.includes(`#account-review-${tee}`) && sent[0].html.includes(`#account-review-${pen}`) && !sent[0].html.includes(`#account-review-${mug}`))

    // Problem resolved and delivered later: its own email from its own delivery date.
    const dB = new Date(o.paidAt.getTime() + 9 * DAY)
    assert.equal(await ingestDeliveryEvent({ source: 'printful', eventId: 'pf-1', shipmentId: shB, status: 'delivered', occurredAt: dB.toISOString() }), 'applied')
    await run(at(dB, 13))
    assert.equal(sent.length, 1)
    await run(at(dB, 14))
    assert.equal(sent.length, 2)
    assert.ok(sent[1].html.includes(`#account-review-${mug}`))
  })

  it('mixed orders follow each item: reminder at 3 days, digital review at 7, physical after delivery', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    for (const k of ['download_reminder', 'digital_review', 'physical_review']) await enable(admin, k)
    const buyer = await signUp('mixed@example.com')
    const d = await digitalProduct('np-mixed')
    const t = await physicalProduct('tee-mixed')
    const o = await paidOrder(buyer, [d, t])
    assert.deepEqual((await jobs(o.id)).map((j) => `${j.kind}:${j.status}`).sort(), ['digital_review:scheduled', 'download_reminder:scheduled', 'physical_review:held'])
    await run(at(o.paidAt, 3))
    assert.deepEqual(sent.map((m) => m.subject), ['Your nursing goodies are waiting 💕'])
    await run(at(o.paidAt, 7))
    assert.equal(sent.length, 2)
    assert.match(sent[1].subject, /goodies working/)
    await run(at(o.paidAt, 30))
    assert.equal(sent.length, 2, 'the physical request still waits for delivery')
  })

  it('honours opt outs, suppression and refunds at send time', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'digital_review')
    await enable(admin, 'download_reminder')
    const a = await signUp('optout@example.com')
    const p = await digitalProduct('np-opt')
    const oa = await paidOrder(a, [p])
    // Opting out of review requests leaves download reminders on.
    const me = await api('/api/account/profile', { session: a, method: 'PATCH', body: { name: 'Opt Out', order_updates: true, product_updates: true, marketing: false, download_reminders: true, review_requests: false } })
    assert.equal(me.status, 200)
    const b = await signUp('bounced@example.com')
    const ob = await paidOrder(b, [await digitalProduct('np-bounce')])
    await q(`insert into email_suppressions (email, reason) values ('bounced@example.com','Bounced')`)
    const c = await signUp('refunded@example.com')
    const oc = await paidOrder(c, [await digitalProduct('np-refunded')])
    await q(`update orders set status = 'refunded' where id = $1`, [oc.id])

    await run(at(oc.paidAt, 8))
    assert.deepEqual(sent.map((m) => `${m.to}:${m.subject}`), ['optout@example.com:Your nursing goodies are waiting 💕'])
    assert.match((await jobs(oa.id)).find((j) => j.kind === 'digital_review')!.status_reason, /turned off review requests/)
    assert.ok((await jobs(ob.id)).every((j) => j.status_reason.includes('suppressed')))
    assert.ok((await jobs(oc.id)).every((j) => j.status_reason === 'The order was refunded.'))
  })

  it('switching off holds pending emails; switching on sends no backlog until the owner resumes or cancels', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('pause@example.com')
    const o = await paidOrder(buyer, [await digitalProduct('np-pause')])
    const off = await enable(admin, 'download_reminder', false)
    assert.equal(off.held, 1)
    await run(at(o.paidAt, 5))
    assert.equal(sent.length, 0)
    await enable(admin, 'download_reminder', true)
    await run(at(o.paidAt, 6))
    assert.equal(sent.length, 0, 'switching back on does not send the backlog')
    assert.equal((await api('/api/admin/automations/download_reminder/held', { session: admin, body: { action: 'resume' } })).data.count, 1)
    await run(at(o.paidAt, 6))
    assert.equal(sent.length, 1, 'overdue after resuming: sent on the next run')

    // The cancel path.
    const o2 = await paidOrder(await signUp('pause2@example.com'), [await digitalProduct('np-pause2')])
    await enable(admin, 'download_reminder', false)
    await enable(admin, 'download_reminder', true)
    assert.equal((await api('/api/admin/automations/download_reminder/held', { session: admin, body: { action: 'cancel' } })).data.count, 1)
    await run(at(o2.paidAt, 6))
    assert.equal(sent.length, 0)
    assert.equal((await jobs(o2.id))[0].status, 'canceled')
  })

  it('delay changes apply to future purchases unless the owner reschedules; pending requests can be canceled', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const o1 = await paidOrder(await signUp('d1@example.com'), [await digitalProduct('np-d1')])
    await enable(admin, 'download_reminder', true, 5)
    const o2 = await paidOrder(await signUp('d2@example.com'), [await digitalProduct('np-d2')])
    assert.equal(new Date((await jobs(o1.id))[0].due_at!).getTime(), o1.paidAt.getTime() + 3 * DAY, 'existing request keeps its time')
    assert.equal(new Date((await jobs(o2.id))[0].due_at!).getTime(), o2.paidAt.getTime() + 5 * DAY)
    assert.equal((await api('/api/admin/automations/download_reminder/reschedule', { session: admin, body: {} })).data.count, 2)
    assert.equal(new Date((await jobs(o1.id))[0].due_at!).getTime(), o1.paidAt.getTime() + 5 * DAY)

    const list = await api('/api/admin/automations/jobs?kind=download_reminder&status=scheduled', { session: admin })
    assert.equal(list.data.jobs.length, 2)
    assert.ok(list.data.jobs[0].order_number && list.data.jobs[0].customer_email && list.data.jobs[0].product_title)
    assert.equal((await api(`/api/admin/automations/jobs/${list.data.jobs[0].id}/cancel`, { session: admin, body: {} })).status, 200)
    assert.equal((await api(`/api/admin/automations/jobs/${list.data.jobs[0].id}/cancel`, { session: admin, body: {} })).status, 400)
  })

  it('concurrent runs, repeated payment events and retries never send twice; failures show as failed', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('race@example.com')
    const o = await paidOrder(buyer, [await digitalProduct('np-race'), await digitalProduct('np-race2')])
    const now = at(o.paidAt, 3)
    await Promise.all([runAutomations({ now }), runAutomations({ now }), runAutomations({ now })])
    await Promise.all([drainOutbox(), drainOutbox()])
    assert.equal(sent.length, 1)
    assert.equal((await q(`select 1 from emails where type = 'download_reminder'`)).length, 1)

    // A temporary sending failure is retried safely, without a second request.
    const o2 = await paidOrder(await signUp('flaky@example.com'), [await digitalProduct('np-flaky')])
    let fail = true
    setSender(async (m) => {
      if (fail) return { error: 'Temporary network problem' }
      sent.push(m)
      return { id: `re_ok_${Date.now()}` }
    })
    await run(at(o2.paidAt, 3))
    const failed = await api('/api/admin/automations/jobs?status=failed', { session: admin })
    assert.equal(failed.data.jobs.length, 1, 'shown as failed, never as sent')
    assert.match(failed.data.jobs[0].display_reason, /Temporary network problem/)
    fail = false
    await q(`update emails set failed_at = now() - interval '11 minutes' where type = 'download_reminder' and status = 'failed'`)
    await requeueStalled()
    await drainOutbox()
    assert.equal(sent.filter((m) => m.to === 'flaky@example.com').length, 1)
    assert.equal((await q(`select 1 from emails where to_email = 'flaky@example.com' and type = 'download_reminder'`)).length, 1, 'the retry reuses the same email')

    // Not configured: recorded, never claimed as sent.
    setSender(null)
    const o3 = await paidOrder(await signUp('noresend@example.com'), [await digitalProduct('np-noresend')])
    await run(at(o3.paidAt, 3))
    const nc = (await api('/api/admin/automations/jobs?status=failed', { session: admin })).data.jobs.find((j: { customer_email: string }) => j.customer_email === 'noresend@example.com')
    assert.match(nc.display_reason, /awaiting Resend/)
  })

  it('previews and test sends use sample details and change no schedules, reviews or downloads', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('safe@example.com')
    const o = await paidOrder(buyer, [await digitalProduct('np-safe')])
    const before = { ents: await entSnapshot(buyer.id), jobs: JSON.stringify(await jobs(o.id)) }

    const pv = await api('/api/admin/automations/digital_review/preview', { session: admin, body: { template: { subject: 'Tell us {{name}}', heading: 'Hi', body: 'Hi {{name}}, honest thoughts welcome.', button_label: 'Leave a review' } } })
    assert.equal(pv.status, 200)
    assert.equal(pv.data.subject, 'Tell us Taylor')
    assert.equal((await api('/api/admin/automations/digital_review/preview', { session: admin, body: { template: { subject: '<b>x</b>', heading: 'h', body: 'b', button_label: '' } } })).status, 400)
    assert.equal((await api('/api/admin/automations/digital_review/preview', { session: buyer, body: {} })).status, 403)

    const t = await api('/api/admin/automations/download_reminder/test', { session: admin, body: { to: 'owner-inbox@example.com' } })
    assert.equal(t.status, 200)
    await settle()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'owner-inbox@example.com')
    assert.match(sent[0].subject, /^\[Test\] /)
    assert.equal(await entSnapshot(buyer.id), before.ents)
    assert.equal(JSON.stringify(await jobs(o.id)), before.jobs)
    assert.equal((await q('select 1 from reviews')).length, 0)
  })

  it('preference links show the setting without changing it, and change only that setting when the customer confirms', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'download_reminder')
    const buyer = await signUp('prefs@example.com')
    const o = await paidOrder(buyer, [await digitalProduct('np-prefs')])
    await run(at(o.paidAt, 3))
    const token = decodeURIComponent(sent[0].html.match(/email-preferences\?t=([^"&]+)/)![1])
    const view = await api(`/api/email-preferences?t=${encodeURIComponent(token)}`)
    assert.equal(view.status, 200)
    assert.equal(view.data.subscribed, true)
    assert.equal(view.data.email, 'p•••@example.com')
    assert.equal((await one<{ n: number }>('select count(*)::int as n from customer_profiles where user_id = $1 and download_reminders = false', [buyer.id]))!.n, 0, 'opening the link changes nothing')
    assert.equal((await api('/api/email-preferences', { body: { t: token, subscribed: false } })).data.subscribed, false)
    const prefs = await one<{ download_reminders: boolean; review_requests: boolean; order_updates: boolean }>('select download_reminders, review_requests, order_updates from customer_profiles where user_id = $1', [buyer.id])
    assert.deepEqual(prefs, { download_reminders: false, review_requests: true, order_updates: true })
    assert.equal((await api(`/api/email-preferences?t=${encodeURIComponent(token.slice(0, -2) + 'xx')}`)).status, 400, 'a tampered link is refused')
  })

  it('accepts signed delivery events from a future integration and refuses unsigned ones', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'physical_review')
    const buyer = await signUp('hook@example.com')
    const o = await paidOrder(buyer, [await physicalProduct('tee-hook')])
    await shipment(admin, o.id, undefined, 'PF123')
    const body = JSON.stringify({ source: 'printful', event_id: 'pf-evt-1', tracking_number: 'PF123', status: 'delivered', occurred_at: new Date(o.paidAt.getTime() + 4 * DAY).toISOString() })
    const sig = createHmac('sha256', process.env.DELIVERY_WEBHOOK_SECRET!).update(body).digest('hex')
    const bad = await api('/api/webhooks/delivery', { method: 'POST', body: JSON.parse(body), headers: { 'x-nlc-signature': 'nope' } })
    assert.equal(bad.status, 400)
    const ok = await api('/api/webhooks/delivery', { method: 'POST', body: JSON.parse(body), headers: { 'x-nlc-signature': sig } })
    assert.equal(ok.status, 200, JSON.stringify(ok.data))
    assert.equal(ok.data.result, 'applied')
    assert.equal((await jobs(o.id))[0].status, 'scheduled')
  })

  it('a refund event after scheduling cancels nothing early but the send is skipped', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await enable(admin, 'digital_review')
    const buyer = await signUp('laterefund@example.com')
    const p = await digitalProduct('np-late')
    const o = await paidOrder(buyer, [p])
    const item = await one<{ id: string }>('select id from order_items where order_id = $1', [o.id])
    await q(`insert into refunds (order_id, amount_cents, items, status, stripe_refund_id) values ($1,$2,$3,'pending','re_late')`, [o.id, o.subtotal, JSON.stringify([{ order_item_id: item!.id, quantity: 1 }])])
    const pi = (await one<{ pi: string }>('select stripe_payment_intent_id as pi from orders where id = $1', [o.id]))!.pi
    await postStripe(stripeEvent('charge.refunded', { id: 'ch_late', object: 'charge', payment_intent: pi, amount_refunded: o.subtotal, refunds: { data: [{ id: 're_late', amount: o.subtotal, status: 'succeeded' }] } }))
    await run(at(o.paidAt, 7))
    assert.equal(sent.length, 0)
    assert.match((await jobs(o.id))[0].status_reason, /refunded/)
  })
})
