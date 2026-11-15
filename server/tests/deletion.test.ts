import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { storage } from '../lib/storage.js'
import { deleteArchivedOnce } from '../services/deletion.js'
import { api, digitalProduct, entitlementsFor, one, payOrder, pendingOrder, q, setup, signUp, stagedUpload, teardown } from './helpers.js'

beforeEach(setup)
after(teardown)

const exists = async (key: string) => storage().size(key).then(() => true, () => false)

async function banner(status = 'draft') {
  const b = await one<{ id: string }>(`insert into marketing_banners (name, style, placement, headline, status) values ('Old sale', 'strip', 'below_hero', 'Sale', $1) returning id`, [status])
  return b!.id
}
async function quiz(status = 'draft') {
  const r = await one<{ id: string }>(`insert into quizzes (name, status, draft, version) values ('Old quiz', $1, '{}', 0) returning id`, [status])
  return r!.id
}
async function tutorial(status = 'draft') {
  const r = await one<{ id: string }>(`insert into tutorials (slug, title, category, status) values ('old-${status}-${Math.random().toString(36).slice(2, 8)}', 'Old video', 'digital-files', $1) returning id`, [status])
  return r!.id
}

describe('Delete forever', () => {
  it('deletes an unsold product with its versions, uploads and files', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await digitalProduct('never-sold')
    await stagedUpload(id, 2)
    const keys = (await q<{ k: string }>('select storage_key as k from product_versions where product_id = $1 union select storage_key from product_file_uploads where product_id = $1', [id])).map((r) => r.k)
    assert.equal(keys.length, 2)
    for (const k of keys) assert.ok(await exists(k))

    const res = await api(`/api/admin/products/${id}`, { session: admin, method: 'DELETE' })
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal(await one('select 1 from products where id = $1', [id]), null)
    assert.equal(await one('select 1 from product_versions where product_id = $1', [id]), null)
    for (const k of keys) assert.equal(await exists(k), false, `${k} removed from storage`)
    assert.ok(await one(`select 1 from audit_log where action = 'product.deleted' and entity_id = $1`, [id]))
    assert.equal((await api(`/api/admin/products/${id}`, { session: admin, method: 'DELETE' })).status, 404)
  })

  it('released files stay unchangeable outside Delete forever', async () => {
    const id = await digitalProduct('locked-files')
    await assert.rejects(q('delete from product_versions where product_id = $1', [id]), /immutable/)
    await assert.rejects(q(`update product_versions set notes = 'x' where product_id = $1`, [id]), /immutable/)
  })

  it('refuses a product someone bought, so their order and download stay', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const id = await digitalProduct('sold-one')
    const order = await pendingOrder(buyer, [{ productId: id }])
    await payOrder(order.id, order.subtotal)
    const res = await api(`/api/admin/products/${id}`, { session: admin, method: 'DELETE' })
    assert.equal(res.status, 409)
    assert.match(res.data.error, /Deactivate/)
    assert.ok(await one('select 1 from products where id = $1', [id]))
    assert.equal((await entitlementsFor(buyer.id)).length, 1)
  })

  it('deletes banners, quizzes and tutorials, and only admins can', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    const b = await banner('published')
    const z = await quiz()
    const t = await tutorial('published')
    for (const path of [`/api/admin/marketing/banners/${b}`, `/api/admin/quizzes/${z}`, `/api/admin/tutorials/${t}`]) {
      assert.equal((await api(path, { session: buyer, method: 'DELETE' })).status, 403, path)
      assert.equal((await api(path, { session: admin, method: 'DELETE' })).status, 200, path)
    }
    assert.equal(await one('select 1 from marketing_banners where id = $1', [b]), null)
    assert.equal(await one('select 1 from quizzes where id = $1', [z]), null)
    assert.equal(await one('select 1 from tutorials where id = $1', [t]), null)
  })

  it('Archive is gone everywhere', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const id = await digitalProduct('no-archive')
    assert.equal((await api(`/api/admin/products/${id}/archive`, { session: admin, method: 'POST' })).status, 404)
    assert.equal((await api(`/api/admin/marketing/banners/${await banner()}/archive`, { session: admin, method: 'POST' })).status, 400)
    assert.equal((await api(`/api/admin/quizzes/${await quiz()}/archive`, { session: admin, method: 'POST' })).status, 400)
    assert.equal((await api(`/api/admin/tutorials/${await tutorial()}/archive`, { session: admin, method: 'POST' })).status, 404)
    assert.equal(await one(`select 1 from products where archived_at is not null`), null)
  })

  it('deletes everything archived once, keeping bought products turned off', async () => {
    const buyer = await signUp('buyer@example.com')
    const unsold = await digitalProduct('archived-unsold')
    const sold = await digitalProduct('archived-sold')
    const order = await pendingOrder(buyer, [{ productId: sold }])
    await payOrder(order.id, order.subtotal)
    const live = await digitalProduct('still-live')
    await q('update products set archived_at = now(), active = false where id = any($1)', [[unsold, sold]])
    const oldBanner = await banner('archived')
    const keepBanner = await banner('draft')
    const oldQuiz = await quiz('archived')
    const oldTutorial = await tutorial('archived')

    const result = await deleteArchivedOnce()
    assert.equal(result!.deleted, 4)
    assert.deepEqual(result!.kept, ['Test archived-sold'])
    assert.equal(await one('select 1 from products where id = $1', [unsold]), null)
    const kept = await one<{ archived_at: string | null; active: boolean }>('select archived_at, active from products where id = $1', [sold])
    assert.deepEqual(kept, { archived_at: null, active: false })
    assert.ok(await one('select 1 from products where id = $1 and active', [live]))
    assert.equal(await one('select 1 from marketing_banners where id = $1', [oldBanner]), null)
    assert.ok(await one('select 1 from marketing_banners where id = $1', [keepBanner]))
    assert.equal(await one('select 1 from quizzes where id = $1', [oldQuiz]), null)
    assert.equal(await one('select 1 from tutorials where id = $1', [oldTutorial]), null)
    assert.equal((await entitlementsFor(buyer.id)).length, 1)
    // It only ever runs once.
    await banner('archived')
    assert.equal(await deleteArchivedOnce(), null)
  })
})
