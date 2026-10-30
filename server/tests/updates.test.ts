import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { runUpdateNotifications } from '../services/updates.js'
import { requeueStalled } from '../email/outbox.js'
import { api, digitalProduct, drainOutbox, entitlementsFor, one, payOrder, pendingOrder, q, setSender, setup, signUp, stagedUpload, teardown, type Session } from './helpers.js'

const sent: Array<{ to: string; subject: string; html: string; text: string }> = []
const capture = () =>
  setSender(async (m) => {
    sent.push(m)
    return { id: `re_${sent.length}_${Date.now()}` }
  })
const updateEmails = () => sent.filter((m) => /updated version/.test(m.subject))

async function settle() {
  for (let i = 0; i < 50; i++) {
    await drainOutbox()
    if (!(await one(`select 1 from emails where status in ('queued','sending')`)) && !(await one(`select 1 from update_notifications where status in ('scheduled','processing')`))) return
    await runUpdateNotifications()
    await new Promise((r) => setTimeout(r, 20))
  }
}
/** Lets a background send started by a save finish before the test changes rows. */
async function idle() {
  for (let i = 0; i < 100 && (await one(`select 1 from update_notifications where status in ('scheduled','processing')`)); i++) await new Promise((r) => setTimeout(r, 20))
}
async function buy(user: Session, productId: string) {
  const o = await pendingOrder(user, [{ productId }])
  await payOrder(o.id, o.subtotal)
  return o
}
async function download(session: Session, entitlementId: string) {
  const prep = await api(`/api/downloads/${entitlementId}/prepare`, { session, method: 'POST' })
  assert.equal(prep.status, 200, JSON.stringify(prep.data))
  const got = await api(prep.data.url, { session })
  assert.equal(got.status, 200)
}
const available = async (u: Session) => (await entitlementsFor(u.id)).filter((e) => e.status === 'available')
async function save(admin: Session, productId: string, extra: Record<string, unknown> = {}) {
  const detail = await api(`/api/admin/products/${productId}`, { session: admin })
  return api(`/api/admin/products/${productId}`, { session: admin, method: 'PUT', body: { ...detail.data.product, ...extra } })
}
const currentVersion = async (productId: string) => (await one<{ n: number }>('select v.version_number as n from products p join product_versions v on v.id = p.current_version_id where p.id = $1', [productId]))!.n

/** A published product with two buyers: "downloaded" used version 1, "never" did not. */
async function scenario() {
  const admin = await signUp('owner@example.com', 'admin')
  const productId = await digitalProduct('np-update')
  const downloaded = await signUp('downloaded@example.com', 'customer', 'Dana Nurse')
  const never = await signUp('never@example.com')
  await buy(downloaded, productId)
  await buy(never, productId)
  await download(downloaded, (await available(downloaded))[0].id)
  await settle()
  sent.length = 0
  return { admin, productId, downloaded, never }
}

describe('automatic product updates on save', () => {
  beforeEach(async () => {
    await setup()
    sent.length = 0
    capture()
  })
  after(teardown)

  it('uploading alone releases nothing; saving releases it, gives one download each and emails only past downloaders', async () => {
    const { admin, productId, downloaded, never } = await scenario()
    const neverBefore = (await entitlementsFor(never.id)).map((e) => e.id)
    const uploadId = await stagedUpload(productId, 2)
    await settle()
    assert.equal(await currentVersion(productId), 1, 'an upload by itself changes nothing')
    assert.equal((await available(downloaded)).length, 0)

    const r = await save(admin, productId, { replacement_upload_id: uploadId, update_notes: 'Added a fluid balance page.' })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.file.outcome, 'released')
    assert.equal(r.data.file.versionNumber, 2)
    assert.equal(r.data.file.granted, 2)
    assert.equal(r.data.file.notifications, 1, 'only the customer who downloaded version 1')
    assert.equal(await currentVersion(productId), 2)
    for (const u of [downloaded, never]) assert.equal((await available(u)).length, 1, 'exactly one available download, never stacked')
    const neverEnts = await entitlementsFor(never.id)
    assert.equal(neverEnts.find((e) => e.id === neverBefore[0])!.status, 'superseded', 'the unused older download now gives the latest version')

    await settle()
    assert.equal(updateEmails().length, 1)
    const m = updateEmails()[0]
    assert.equal(m.to, 'downloaded@example.com')
    assert.equal(m.subject, 'An updated version of Test np-update is ready 💕')
    assert.match(m.text, /version 2, updated/)
    assert.match(m.text, /What changed: Added a fluid balance page\./)
    assert.match(m.text, /One download of the updated version is ready/)
    assert.ok(m.html.includes('/#account-downloads'), 'My downloads button')
    assert.ok(!/\/api\/downloads|deliver|token=/.test(m.html), 'no file or redemption link')
    assert.match(m.text, /Hi Dana,/)

    // Opening My downloads uses nothing.
    const snap = JSON.stringify(await entitlementsFor(downloaded.id))
    assert.equal((await api('/api/account/downloads', { session: downloaded })).status, 200)
    assert.equal(JSON.stringify(await entitlementsFor(downloaded.id)), snap)

    // The status the owner sees after saving.
    const detail = await api(`/api/admin/products/${productId}`, { session: admin })
    const release = detail.data.releases[0]
    assert.equal(release.trigger, 'save')
    assert.deepEqual(detail.data.releaseStatus[release.id], { queued: 0, sent: 1, skipped: 0, held: 0, failed: 0, canceled: 0 })

    // A retried save with the same file changes nothing.
    const again = await save(admin, productId, { replacement_upload_id: uploadId })
    assert.equal(again.data.file.outcome, 'already_released')
    await settle()
    assert.equal(updateEmails().length, 1)
    assert.equal((await q('select 1 from product_versions where product_id = $1', [productId])).length, 2)
  })

  it('notes are optional; the same content under another file name, listing edits, drafts and first files never notify or grant', async () => {
    const { admin, productId, downloaded } = await scenario()
    const before = JSON.stringify(await entitlementsFor(downloaded.id))

    // Identical content with a different file name.
    const dup = await one<{ id: string }>(
      `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256)
       select product_id, storage_key, 'renamed-copy.pdf', content_type, file_size, sha256 from product_versions where product_id = $1 returning id`,
      [productId],
    )
    const r = await save(admin, productId, { replacement_upload_id: dup!.id })
    assert.equal(r.data.file.outcome, 'identical')
    assert.equal(await currentVersion(productId), 1)

    // Listing edit only.
    assert.equal((await save(admin, productId, { title: 'Renamed' })).data.file, null)
    await settle()
    assert.equal(updateEmails().length, 0)
    assert.equal(JSON.stringify(await entitlementsFor(downloaded.id)), before)

    // Draft product with a file: the new file stays staged.
    await api(`/api/admin/products/${productId}/unpublish`, { session: admin, method: 'POST' })
    const staged = await stagedUpload(productId, 7)
    assert.equal((await save(admin, productId, { replacement_upload_id: staged })).data.file.outcome, 'kept_for_draft')
    assert.equal(await currentVersion(productId), 1)
    assert.equal(JSON.stringify(await entitlementsFor(downloaded.id)), before)

    // Notes are optional once published again.
    await api(`/api/admin/products/${productId}/publish`, { session: admin, method: 'POST' })
    const pub = await save(admin, productId, { replacement_upload_id: staged })
    assert.equal(pub.data.file.outcome, 'released')
    await settle()
    assert.equal(updateEmails().length, 1)
    assert.ok(!/What changed/.test(updateEmails()[0].text))

    // A brand new product's first file notifies nobody.
    const created = await api('/api/admin/products', { session: admin, body: { title: 'Fresh insert', slug: 'fresh-insert', category: 'np-inserts', type: 'digital', price_cents: 900 } })
    const first = await stagedUpload(created.data.id, 1)
    const fr = await save(admin, created.data.id, { replacement_upload_id: first })
    assert.equal(fr.data.file.outcome, 'first_file')
    assert.equal(fr.data.file.notifications, 0)
  })

  it('a failed save keeps the previous version and grants or queues nothing; a rejected upload stores nothing', async () => {
    const { admin, productId, downloaded } = await scenario()
    const before = JSON.stringify(await entitlementsFor(downloaded.id))
    const uploadId = await stagedUpload(productId, 2)
    const bad = await save(admin, productId, { replacement_upload_id: uploadId, title: '' })
    assert.equal(bad.status, 400)
    assert.equal(await currentVersion(productId), 1)
    assert.equal(JSON.stringify(await entitlementsFor(downloaded.id)), before)
    assert.equal((await q('select 1 from update_notifications')).length, 0)
    assert.ok(await one('select 1 from product_file_uploads where id = $1 and released_version_id is null', [uploadId]), 'the upload is still waiting for a successful save')

    const notPdf = await api(`/api/admin/products/${productId}/files`, { session: admin, body: Buffer.from('not a real pdf'), headers: { 'content-type': 'application/pdf', 'x-file-name': 'fake.pdf' } })
    assert.ok(notPdf.status >= 400, 'invalid files are refused')
    assert.equal((await q('select 1 from product_file_uploads where product_id = $1', [productId])).length, 1)
  })

  it('concurrent saves and successive updates: one release per file, one download, one email about the latest version', async () => {
    const { admin, productId, downloaded, never } = await scenario()
    setSender(null) // hold emails while both saves land
    const u2 = await stagedUpload(productId, 2)
    const u3 = await stagedUpload(productId, 3)
    const results = await Promise.all([save(admin, productId, { replacement_upload_id: u2 }), save(admin, productId, { replacement_upload_id: u2 }), save(admin, productId, { replacement_upload_id: u3 })])
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.data)))
    assert.equal(await currentVersion(productId), 3)
    assert.equal((await q('select 1 from product_versions where product_id = $1', [productId])).length, 3, 'the same file is released once')
    for (const u of [downloaded, never]) assert.equal((await available(u)).length, 1)

    await idle()
    capture()
    await q(`update update_notifications set status = 'scheduled' where status = 'held'`)
    await settle()
    assert.equal(updateEmails().length, 1, 'pending notice for the replaced version is consolidated')
    assert.equal((await one<{ n: number }>(`select count(*)::int as n from update_notifications where status = 'canceled'`))!.n, 1)
    assert.match(updateEmails()[0].text, /version 3/)

    // Successive update: the customer downloads version 3, then version 4 arrives.
    await download(downloaded, (await available(downloaded))[0].id)
    sent.length = 0
    const u4 = await stagedUpload(productId, 4)
    assert.equal((await save(admin, productId, { replacement_upload_id: u4 })).data.file.notifications, 1)
    await settle()
    assert.equal(updateEmails().length, 1)
    assert.match(updateEmails()[0].text, /version 4/)
    assert.equal((await q(`select 1 from update_notifications where user_id = $1`, [never.id])).length, 0, 'never downloaded: never emailed')
  })

  it('rechecks before sending: latest already downloaded, refunds, multiple purchases', async () => {
    const { admin, productId, downloaded } = await scenario()
    // Second customer bought twice and downloaded once: one email, not two.
    const twice = await signUp('twice@example.com')
    await buy(twice, productId)
    await buy(twice, productId)
    await download(twice, (await available(twice))[0].id)
    const refunded = await signUp('refunded@example.com')
    const ro = await buy(refunded, productId)
    await download(refunded, (await available(refunded))[0].id)
    await settle()
    sent.length = 0

    setSender(null)
    const u2 = await stagedUpload(productId, 2)
    assert.equal((await save(admin, productId, { replacement_upload_id: u2 })).data.file.notifications, 3)
    await q(`update order_items set refunded_quantity = quantity where order_id = $1`, [ro.id])
    await q(`update orders set status = 'refunded' where id = $1`, [ro.id])
    // Downloads the new version before the email goes out.
    await download(downloaded, (await available(downloaded))[0].id)
    await idle()
    capture()
    await q(`update update_notifications set status = 'scheduled' where status = 'held'`)
    await settle()
    assert.deepEqual(updateEmails().map((m) => m.to), ['twice@example.com'])
    const reasons = await q<{ status_reason: string }>('select status_reason from update_notifications where status = $1 order by status_reason', ['skipped'])
    assert.deepEqual(reasons.map((r) => r.status_reason), ['Already downloaded the latest version.', 'No eligible purchase any more (refunded, disputed or canceled).'])
  })

  it('without Resend the notifications are held and kept; the owner retries once connected; temporary failures retry once', async () => {
    const { admin, productId } = await scenario()
    setSender(null)
    const u2 = await stagedUpload(productId, 2)
    const r = await save(admin, productId, { replacement_upload_id: u2 })
    assert.equal(r.data.emailConfigured, false)
    await settle()
    const held = await one<{ status: string; status_reason: string }>('select status, status_reason from update_notifications')
    assert.equal(held!.status, 'held')
    assert.match(held!.status_reason, /not connected/)
    assert.equal((await q(`select 1 from emails where type = 'product_update'`)).length, 0, 'nothing pretends to be sent')
    const releaseId = r.data.file.releaseId
    assert.equal((await api(`/api/admin/products/${productId}/releases/${releaseId}/notifications/retry`, { session: admin, body: {} })).status, 400)
    const status = (await api(`/api/admin/products/${productId}`, { session: admin })).data.releaseStatus[releaseId]
    assert.equal(status.held, 1)

    // Connected, but the first send fails temporarily.
    let fail = true
    setSender(async (m) => {
      if (fail) return { error: 'Temporary network problem' }
      sent.push(m)
      return { id: `re_${Date.now()}` }
    })
    assert.equal((await api(`/api/admin/products/${productId}/releases/${releaseId}/notifications/retry`, { session: admin, body: {} })).data.count, 1)
    await settle()
    assert.equal((await api(`/api/admin/products/${productId}`, { session: admin })).data.releaseStatus[releaseId].failed, 1, 'shown as failed, not sent')
    fail = false
    await q(`update emails set failed_at = now() - interval '11 minutes' where type = 'product_update'`)
    await requeueStalled()
    await settle()
    assert.equal(updateEmails().length, 1)
    assert.equal((await q(`select 1 from emails where type = 'product_update'`)).length, 1, 'the retry reuses the same email')
    assert.equal((await api(`/api/admin/products/${productId}`, { session: admin })).data.releaseStatus[releaseId].sent, 1)
    // The update and its downloads were never undone by the email trouble.
    assert.equal(await currentVersion(productId), 2)
  })
})
