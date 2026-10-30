import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { revenueReport } from '../services/reports.js'
import { contactSuppressed, setListProvider, syncMarketingContacts } from '../services/consent.js'
import { CONSENT_WORDING } from '../../shared/consent.js'
import { api, digitalProduct, drainOutbox, entitlementsFor, one, payOrder, pendingOrder, postResend, q, setSender, setup, signUp, teardown, type Session } from './helpers.js'

async function freebie(admin: Session, slug = 'free-planner') {
  const id = await digitalProduct(slug, 900)
  const detail = (await api(`/api/admin/products/${id}`, { session: admin })).data.product
  const r = await api(`/api/admin/products/${id}`, { session: admin, method: 'PUT', body: { ...detail, is_freebie: true } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return id
}
const checkout = (user: Session, ids: string[], joinList?: boolean) => api('/api/checkout', { session: user, body: { items: ids.map((productId) => ({ productId, quantity: 1 })), join_list: joinList } })
const events = (email: string) => q<{ action: string; source: string; wording_version: string; wording: string; order_id: string | null }>('select action, source, wording_version, wording, order_id from marketing_consent_events where email = $1 order by id', [email])

describe('freebies and email list consent', () => {
  beforeEach(async () => {
    await setup()
    setListProvider(undefined)
  })
  after(async () => {
    setListProvider(undefined)
    await teardown()
  })

  it('the freebie checkbox sets $0, only for downloads; leaving needs a new price', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await freebie(admin)
    const p = await one<{ price_cents: number; sale_price_cents: number | null; is_freebie: boolean }>('select price_cents, sale_price_cents, is_freebie from products where id = $1', [id])
    assert.deepEqual(p, { price_cents: 0, sale_price_cents: null, is_freebie: true })
    const detail = (await api(`/api/admin/products/${id}`, { session: admin })).data.product
    const off = await api(`/api/admin/products/${id}`, { session: admin, method: 'PUT', body: { ...detail, is_freebie: false } })
    assert.equal(off.status, 400, 'no silent price restore')
    assert.match(off.data.error, /selling price/)
    assert.equal((await api(`/api/admin/products/${id}`, { session: admin, method: 'PUT', body: { ...detail, is_freebie: false, price_cents: 0 } })).status, 400)
    assert.equal((await api(`/api/admin/products/${id}`, { session: admin, method: 'PUT', body: { ...detail, is_freebie: false, price_cents: 1500 } })).status, 200)
    const tee = await api('/api/admin/products', { session: admin, body: { title: 'Free tee', slug: 'free-tee', category: 'apparel', type: 'physical', is_freebie: true } })
    assert.equal(tee.status, 400)
    const cat = (await api('/api/catalog')).data.products.find((x: { id: string }) => x.id === id)
    assert.equal(cat.isFreebie, false)
  })

  it('a free bag completes as a real $0 order without payment details, after the customer joins the list', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await freebie(admin)
    const sent: string[] = []
    setSender(async (m) => {
      sent.push(`${m.to}|${m.subject}|${m.html.includes('/#account-downloads')}`)
      return { id: `re_${sent.length}` }
    })
    const buyer = await signUp('free@example.com', 'customer', 'Fran Free')
    assert.equal((await api('/api/account/marketing', { session: buyer })).data.status, 'never')

    const refused = await checkout(buyer, [id], false)
    assert.equal(refused.status, 400)
    assert.equal(refused.data.code, 'freebie_needs_list')
    assert.equal((await q('select 1 from orders')).length, 0, 'nothing recorded without the signup')

    // Payments are not configured in these tests: a free claim never needs them.
    const ok = await checkout(buyer, [id], true)
    assert.equal(ok.status, 200, JSON.stringify(ok.data))
    assert.equal(ok.data.free, true)
    const o = await one<{ status: string; total_cents: number; is_free_claim: boolean; stripe_checkout_session_id: string | null }>('select status, total_cents, is_free_claim, stripe_checkout_session_id from orders')
    assert.deepEqual(o, { status: 'paid', total_cents: 0, is_free_claim: true, stripe_checkout_session_id: null })
    const ents = await entitlementsFor(buyer.id)
    assert.deepEqual(ents.map((e) => e.status), ['available'], 'one download, in the account')
    const list = (await api('/api/account/downloads', { session: buyer })).data.downloads
    assert.equal(list.length, 1)

    const ev = await events('free@example.com')
    assert.equal(ev.length, 1)
    assert.equal(ev[0].action, 'subscribe')
    assert.equal(ev[0].source, 'freebie_checkout')
    assert.equal(ev[0].wording_version, 'freebie-v1')
    assert.equal(ev[0].wording, CONSENT_WORDING['freebie-v1'])
    assert.ok(ev[0].order_id)
    assert.equal((await api('/api/account/marketing', { session: buyer })).data.status, 'subscribed')
    assert.equal((await api('/api/account/me', { session: buyer })).data.preferences.marketing, true)

    await drainOutbox()
    assert.deepEqual(sent, ['free@example.com|Your free resource is ready 💕|true'], 'a free order confirmation, no payment receipt')

    // Duplicate claims, one after another or at the same time, never add downloads.
    const again = await checkout(buyer, [id], true)
    assert.equal(again.status, 409)
    const other = await signUp('race@example.com')
    const raced = await Promise.all([checkout(other, [id], true), checkout(other, [id], true), checkout(other, [id], true)])
    assert.equal(raced.filter((r) => r.status === 200).length, 1)
    assert.equal((await entitlementsFor(other.id)).length, 1)
    assert.equal((await events('race@example.com')).length, 1, 'one signup record')

    // The file stays private: another customer cannot prepare this download.
    assert.equal((await api(`/api/downloads/${ents[0].id}/prepare`, { session: other, method: 'POST' })).status, 404)
    assert.equal((await api(`/api/downloads/${ents[0].id}/prepare`, { method: 'POST' })).status, 401)
  })

  it('existing subscribers claim without a new signup; past unsubscribes need a new explicit signup', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await freebie(admin)
    const sub = await signUp('sub@example.com')
    await api('/api/account/profile', { session: sub, method: 'PATCH', body: { name: 'Sub', marketing: true } })
    assert.equal((await api('/api/account/marketing', { session: sub })).data.status, 'subscribed')
    assert.equal((await checkout(sub, [id], false)).status, 200, 'already on the list')
    assert.deepEqual((await events('sub@example.com')).map((e) => `${e.action}:${e.source}`), ['subscribe:account_settings'], 'not treated as a new signup')

    const gone = await signUp('gone@example.com')
    await api('/api/account/profile', { session: gone, method: 'PATCH', body: { name: 'Gone', marketing: true } })
    await api('/api/account/profile', { session: gone, method: 'PATCH', body: { name: 'Gone', marketing: false } })
    const status = (await api('/api/account/marketing', { session: gone })).data
    assert.equal(status.status, 'unsubscribed')
    assert.ok(status.since)
    assert.equal((await checkout(gone, [id], false)).status, 400, 'never silently resubscribed')
    assert.equal((await checkout(gone, [id], true)).status, 200)
    assert.deepEqual((await events('gone@example.com')).map((e) => `${e.action}:${e.source}`), ['subscribe:account_settings', 'unsubscribe:account_settings', 'subscribe:freebie_checkout'])

    // Unsubscribing later keeps the freebie and the receipts.
    const before = JSON.stringify(await entitlementsFor(gone.id))
    await api('/api/account/profile', { session: gone, method: 'PATCH', body: { name: 'Gone', marketing: false } })
    assert.equal(JSON.stringify(await entitlementsFor(gone.id)), before)
    assert.equal((await api('/api/account/orders', { session: gone })).data.orders.length, 1)
    // Consent records cannot be edited.
    await assert.rejects(q(`update marketing_consent_events set source = 'x'`))
  })

  it('mixed bags need the signup for the freebie; paid only bags do not; signup counts only once paid', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const free = await freebie(admin)
    const paid = await digitalProduct('np-paid', 1200)
    const buyer = await signUp('mixed@example.com')
    const mixed = await checkout(buyer, [free, paid], false)
    assert.equal(mixed.data.code, 'freebie_needs_list')
    const paidOnly = await checkout(buyer, [paid], false)
    assert.notEqual(paidOnly.data.code, 'freebie_needs_list', 'joining is optional for paid items (fails only on payments not configured here)')

    // A paid order that chose to join: the signup is recorded when the payment completes.
    const o = await pendingOrder(buyer, [{ productId: paid }])
    await q(`update orders set marketing_request = '{"version":"checkout-v1","ip":null}' where id = $1`, [o.id])
    assert.equal((await events('mixed@example.com')).length, 0)
    await payOrder(o.id, o.subtotal)
    assert.deepEqual((await events('mixed@example.com')).map((e) => `${e.action}:${e.source}:${e.wording_version}`), ['subscribe:checkout:checkout-v1'])
  })

  it('free claims stay out of sales, verified reviews and paid email automations', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await freebie(admin)
    await api('/api/admin/automations/download_reminder', { session: admin, method: 'PUT', body: { enabled: true } })
    await api('/api/admin/automations/digital_review', { session: admin, method: 'PUT', body: { enabled: true } })
    const buyer = await signUp('claim@example.com')
    assert.equal((await checkout(buyer, [id], true)).status, 200)
    assert.equal((await q('select 1 from email_jobs')).length, 0, 'no download reminder or review request for a free claim')
    assert.equal((await api(`/api/account/reviews/${id}`, { session: buyer })).data.eligible, false, 'a $0 claim is not a verified purchase')
    assert.equal((await api('/api/account/reviews', { session: buyer })).data.purchases.length, 0)

    const r = await revenueReport({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000), includeDemo: false })
    assert.equal(r.current.orders, 0, 'not a paid order')
    assert.equal(r.current.newCustomers, 0)
    assert.equal(r.byProduct.length, 0)
    assert.deepEqual(r.freeClaims, { claims: 1, customers: 1 })
    assert.deepEqual(r.customers, { total: 1, paying: 0, freebieOnly: 1 }, 'freebie only customers are shown, apart from paying customers')

    // The future setting: reminders for free claims only when the owner turns it on.
    await api('/api/admin/automations/download_reminder', { session: admin, method: 'PUT', body: { include_freebies: true } })
    const second = await freebie(admin, 'free-two')
    assert.equal((await checkout(buyer, [second], true)).status, 200)
    assert.deepEqual((await q<{ kind: string }>('select kind from email_jobs')).map((j) => j.kind), ['download_reminder'])
  })

  it('consent waits for a mailing list, then syncs without duplicates and respects unsubscribes and bounces', async () => {
    const a = await signUp('one@example.com')
    await api('/api/account/profile', { session: a, method: 'PATCH', body: { name: 'One', marketing: true } })
    setListProvider(null)
    assert.deepEqual(await syncMarketingContacts(), { synced: 0, connected: false })
    assert.equal((await one<{ s: string }>(`select sync_status as s from marketing_contacts`))!.s, 'not_configured', 'kept, not dropped')

    const list = new Map<string, boolean>()
    let calls = 0
    setListProvider({ name: 'Test list', get: async (email) => (list.has(email) ? { unsubscribed: !list.get(email) } : null), upsert: async ({ email, subscribed }) => void (calls++, list.set(email, subscribed)) })
    assert.equal((await syncMarketingContacts()).synced, 1)
    assert.deepEqual([...list], [['one@example.com', true]])
    await api('/api/account/profile', { session: a, method: 'PATCH', body: { name: 'One', marketing: false } })
    await syncMarketingContacts()
    assert.deepEqual([...list], [['one@example.com', false]], 'one contact, now unsubscribed')

    const b = await signUp('bounce@example.com')
    await api('/api/account/profile', { session: b, method: 'PATCH', body: { name: 'B', marketing: true } })
    await q(`insert into email_suppressions (email, reason) values ('bounce@example.com','Bounced')`)
    await contactSuppressed('bounce@example.com') // what the Resend bounce webhook does
    await syncMarketingContacts()
    assert.equal(list.get('bounce@example.com'), false, 'a bounced address is never sent as subscribed')
    assert.equal(list.size, 2, 'one contact per address, however many times it was sent')
    assert.ok(calls >= 3)
    const overview = await api('/api/admin/email-list', { session: await signUp('owner@example.com', 'admin') })
    assert.equal(overview.data.provider.connected, true)
    assert.equal(overview.data.counts.subscribed, 1)
  })

  it('an unsubscribe made in Resend is recorded here and never undone by a later sync', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await freebie(admin)
    const list = new Map<string, boolean>()
    setListProvider({ name: 'Test list', get: async (e) => (list.has(e) ? { unsubscribed: !list.get(e) } : null), upsert: async ({ email, subscribed }) => void list.set(email, subscribed) })
    const buyer = await signUp('webhook@example.com')
    assert.equal((await checkout(buyer, [id], true)).status, 200)
    await syncMarketingContacts()
    assert.equal(list.get('webhook@example.com'), true)

    // The person unsubscribes in a Resend broadcast; Resend sends contact.updated.
    list.set('webhook@example.com', false)
    const evt = { type: 'contact.updated', created_at: new Date().toISOString(), data: { id: 'c_1', email: 'webhook@example.com', unsubscribed: true, updated_at: new Date().toISOString(), created_at: new Date().toISOString() } }
    const r = await postResend(evt, 'msg_contact_1')
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.result, 'unsubscribed')
    assert.equal((await postResend(evt, 'msg_contact_1')).data.result, 'duplicate')
    assert.deepEqual((await events('webhook@example.com')).map((e) => `${e.action}:${e.source}`), ['subscribe:freebie_checkout', 'unsubscribe:resend_unsubscribe'])
    assert.equal((await api('/api/account/marketing', { session: buyer })).data.status, 'unsubscribed')
    assert.equal((await entitlementsFor(buyer.id)).length, 1, 'the freebie is kept')

    // Syncing again never resubscribes them; a re-subscribe event from the list is not consent either.
    await syncMarketingContacts()
    assert.equal(list.get('webhook@example.com'), false)
    const back = await postResend({ ...evt, data: { ...evt.data, unsubscribed: false } }, 'msg_contact_2')
    assert.equal(back.data.result, 'ignored')
    assert.equal((await api('/api/account/marketing', { session: buyer })).data.status, 'unsubscribed')

    // A late event older than a fresh signup in the store is ignored.
    await api('/api/account/profile', { session: buyer, method: 'PATCH', body: { name: 'W', marketing: true } })
    const stale = await postResend({ ...evt, data: { ...evt.data, updated_at: new Date(Date.now() - 3_600_000).toISOString() } }, 'msg_contact_3')
    assert.equal(stale.data.result, 'ignored: older than their latest signup')
    assert.equal((await api('/api/account/marketing', { session: buyer })).data.status, 'subscribed')
  })

  it('a missed unsubscribe webhook is caught before a sync could resubscribe someone', async () => {
    const list = new Map<string, boolean>()
    setListProvider({ name: 'Test list', get: async (e) => (list.has(e) ? { unsubscribed: !list.get(e) } : null), upsert: async ({ email, subscribed }) => void list.set(email, subscribed) })
    const u = await signUp('missed@example.com')
    await api('/api/account/profile', { session: u, method: 'PATCH', body: { name: 'M', marketing: true } })
    // The save also starts a background sync; let every copy land before changing the list.
    for (let i = 0; i < 50; i++) {
      await syncMarketingContacts()
      if (await one(`select 1 from marketing_contacts where email = 'missed@example.com' and sync_status = 'synced' and sync_claimed_at is null`)) break
      await new Promise((r) => setTimeout(r, 20))
    }
    // Unsubscribed in Resend, webhook lost; then something makes the contact pending again (for example a bounce flag cleared).
    list.set('missed@example.com', false)
    await q(`update marketing_contacts set sync_status = 'pending', change_seq = change_seq + 1 where email = 'missed@example.com'`)
    await syncMarketingContacts()
    assert.equal(list.get('missed@example.com'), false, 'not resubscribed')
    assert.equal((await api('/api/account/marketing', { session: u })).data.status, 'unsubscribed')
    assert.deepEqual((await events('missed@example.com')).map((e) => e.source), ['account_settings', 'resend_unsubscribe'])

    // Deleted in Resend: not added back by itself.
    const del = await postResend({ type: 'contact.deleted', created_at: new Date().toISOString(), data: { email: 'missed@example.com', unsubscribed: true } }, 'msg_del_1')
    assert.equal(del.data.result, 'deleted on the list')
    // Suppressions added in Resend are respected.
    const sup = await postResend({ type: 'suppression.added', created_at: new Date().toISOString(), data: { email: 'missed@example.com', origin: 'complaint' } }, 'msg_sup_1')
    assert.equal(sup.data.result, 'suppressed')
    assert.ok(await one(`select 1 from email_suppressions where email = 'missed@example.com'`))
  })
})
