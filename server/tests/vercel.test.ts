import './env.js'
import { FAKE_SUPABASE_PORT } from './vercel-env.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import { buildSamplePlannerPdf } from '../../shared/samplePdf.js'
import { LATEST_MIGRATION } from '../db/schema-version.js'
import { FakeSupabase } from './fake-supabase.js'
import Stripe from 'stripe'
import { Webhook } from 'svix'
import { checkoutCompleted, digitalProduct, drainOutbox, entitlementsFor, GATE, one, ORIGIN, payOrder, pendingOrder, q, setSender, setup, signUp, teardown, type Session } from './helpers.js'

/*
  Runs the store the way Vercel does: requests enter through api/index.ts
  (after vercel.json's rewrite), files live in Supabase Storage (a local
  stand in that follows its REST API), and the staging gate is middleware.ts.
*/

const supabase = new FakeSupabase(process.env.SUPABASE_SERVICE_ROLE_KEY!)
type Handler = (req: Request) => Promise<Response> | Response
let fn: Record<string, Handler>

before(async () => {
  await supabase.start(FAKE_SUPABASE_PORT)
})
after(async () => {
  await supabase.stop()
  await teardown()
})
beforeEach(async () => {
  await setup()
  supabase.objects.clear()
  supabase.readTokens.clear()
  // The function module creates its own pool, as on Vercel; load it once the database is migrated.
  fn ??= (await import('../../api/index.js')) as unknown as Record<string, Handler>
  const { SupabaseStorage } = await import('../lib/storage.js')
  // Bucket limits above the app's own 1 MB test limit, so the server side check is what is tested.
  await new SupabaseStorage().ensureBuckets({ files: 50 * 1024 * 1024, media: 50 * 1024 * 1024 })
})

/** Calls the Vercel function the way vercel.json's rewrite delivers a request for `path`. */
async function call(path: string, opts: { session?: Session | null; method?: string; body?: unknown; headers?: Record<string, string>; gate?: boolean } = {}) {
  const [pathname, query] = path.split('?')
  const url = `${ORIGIN}/api?__path=${encodeURIComponent(pathname.replace(/^\/api\//, ''))}${query ? `&${query}` : ''}`
  const headers: Record<string, string> = { origin: ORIGIN, ...(opts.gate === false ? {} : { authorization: GATE! }), ...(opts.headers ?? {}) }
  if (opts.session) headers.cookie = opts.session.cookie
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const method = opts.method ?? (body ? 'POST' : 'GET')
  const res = await fn[method](new Request(url, { method, headers, body }))
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data: data as any, headers: res.headers }
}

/** What the admin's browser does: ask, send the bytes straight to storage, then confirm. */
async function directUpload(admin: Session, purpose: string, targetId: string, fileName: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
  const start = await call('/api/admin/uploads', { session: admin, body: { purpose, target_id: targetId, file_name: fileName, size: bytes.length, type: 'application/octet-stream', ...extra } })
  if (start.status !== 201) return { start, put: null, complete: null }
  assert.equal(start.data.mode, 'direct')
  const put = await fetch(start.data.url, { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' } })
  const complete = await call(`/api/admin/uploads/${start.data.id}/complete`, { session: admin, body: {} })
  return { start, put, complete }
}

function png(width = 40, height = 30) {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

async function boughtDigital(email = 'buyer@example.com') {
  const buyer = await signUp(email)
  const productId = await digitalProduct(`np-${email.split('@')[0]}`)
  const order = await pendingOrder(buyer, [{ productId }])
  await payOrder(order.id, order.subtotal)
  const [ent] = await entitlementsFor(buyer.id)
  return { buyer, productId, ent }
}

describe('Vercel entry and staging access', () => {
  it('routes rewritten requests, reports health and schema, and keeps the gate on every page', async () => {
    const health = await call('/api/health', { gate: false })
    assert.equal(health.status, 200, JSON.stringify(health.data))
    assert.equal(health.data.schema, 'current')
    assert.equal(health.data.storage, 'supabase')
    assert.equal(health.data.scheduledJobs, 'configured')

    // A database whose migrations were not run says so.
    await q(`delete from schema_migrations where name = $1`, [LATEST_MIGRATION])
    const behind = await call('/api/health', { gate: false })
    assert.equal(behind.status, 503)
    assert.equal(behind.data.schema, 'behind')
    await q(`insert into schema_migrations (name) values ($1)`, [LATEST_MIGRATION])

    // The API refuses anything without the staging password.
    assert.equal((await call('/api/account/me', { gate: false })).status, 401)

    // middleware.ts covers the static pages Vercel serves without the API.
    const { default: middleware } = await import('../../middleware.js')
    const page = (path: string, auth?: string) => middleware(new Request(`${ORIGIN}${path}`, { headers: auth ? { authorization: auth } : {} }))
    for (const path of ['/', '/index.html', '/assets/index.js', '/api/admin/settings']) {
      const r = page(path)
      assert.equal(r.status, 401, path)
      assert.match(r.headers.get('www-authenticate') ?? '', /Basic/)
    }
    assert.equal(page('/', `Basic ${Buffer.from('nurselove:wrong-password-guess').toString('base64')}`).status, 401)
    assert.equal(page('/', GATE!).headers.get('x-middleware-next'), '1')
    for (const open of ['/api/webhooks/stripe', '/api/webhooks/resend', '/api/webhooks/mux', '/api/health', '/api/cron/maintenance']) {
      assert.equal(page(open).headers.get('x-middleware-next'), '1', open)
    }
  })

  it('signs customers and admins in through the function, with roles enforced', async () => {
    const signUpRes = await fn.POST(new Request(`${ORIGIN}/api?__path=auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: GATE! }, body: JSON.stringify({ email: 'shopper@example.com', password: 'Correct-Horse-1', name: 'Shopper' }) }))
    assert.equal(signUpRes.status, 200)
    const signIn = await fn.POST(new Request(`${ORIGIN}/api?__path=auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: GATE! }, body: JSON.stringify({ email: 'shopper@example.com', password: 'Correct-Horse-1' }) }))
    assert.equal(signIn.status, 200)
    const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const shopper = { cookie, id: '', email: 'shopper@example.com' }
    assert.equal((await call('/api/account/me', { session: shopper })).status, 200)
    assert.equal((await call('/api/admin/settings', { session: shopper })).status, 403)
    assert.equal((await call('/api/admin/uploads', { session: shopper, body: { purpose: 'product_file' } })).status, 403)

    const admin = await signUp('owner@example.com', 'admin')
    const settings = await call('/api/admin/settings', { session: admin })
    assert.equal(settings.status, 200)
    assert.equal(JSON.stringify(settings.data).includes(process.env.SUPABASE_SERVICE_ROLE_KEY!), false, 'the service role key never leaves the server')
  })
})

describe('direct uploads to Supabase Storage', () => {
  it('product photos, private files, thumbnails and MP4 videos go straight to storage and are checked before use', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const product = await call('/api/admin/products', { session: admin, body: { title: 'Upload Test', slug: 'upload-test', category: 'np-inserts', type: 'digital', price_cents: 900 } })
    assert.equal(product.status, 201, JSON.stringify(product.data))
    const productId = product.data.id

    const photo = await directUpload(admin, 'product_image', productId, 'cover.png', png(), { image_kind: 'sample' })
    assert.equal(photo.complete!.status, 201, JSON.stringify(photo.complete!.data))
    const img = await one<{ storage_key: string; kind: string; width: number }>('select storage_key, kind, width from product_images where product_id = $1', [productId])
    assert.equal(img!.kind, 'sample')
    assert.equal(img!.width, 40)
    assert.ok(supabase.objects.has(`media/${img!.storage_key}`), 'photos live in the media bucket')

    const pdf = Buffer.from(buildSamplePlannerPdf('Direct upload'))
    const file = await directUpload(admin, 'product_file', productId, 'pages.pdf', pdf)
    assert.equal(file.complete!.status, 201, JSON.stringify(file.complete!.data))
    const up = await one<{ storage_key: string; file_size: number; sha256: string }>('select storage_key, file_size, sha256 from product_file_uploads where product_id = $1', [productId])
    assert.equal(up!.file_size, pdf.length)
    assert.ok(supabase.objects.has(`product-files/${up!.storage_key}`), 'downloads live in the private product files bucket')
    assert.equal(supabase.buckets.get('product-files')!.public, false)
    assert.equal(supabase.buckets.get('media')!.public, false)

    // Confirming twice attaches once.
    assert.equal((await call(`/api/admin/uploads/${file.start.data.id}/complete`, { session: admin, body: {} })).status, 404)
    assert.equal((await q('select 1 from product_file_uploads where product_id = $1', [productId])).length, 1)

    // The upload link works once and cannot overwrite.
    const again = await fetch(file.start.data.url, { method: 'PUT', body: Buffer.from('%PDF-replaced'), headers: { 'content-type': 'application/pdf' } })
    assert.notEqual(again.status, 200)

    // A file that is not what it claims is rejected and removed from storage.
    const fake = await directUpload(admin, 'product_file', productId, 'notes.pdf', Buffer.from('just some text, not a PDF'))
    assert.equal(fake.complete!.status, 415)
    assert.equal([...supabase.objects.keys()].filter((k) => k.includes(fake.start.data.id)).length, 0)
    assert.equal((await q('select 1 from product_file_uploads where product_id = $1', [productId])).length, 1)

    // Size limits apply before upload, and again to what actually arrived.
    const big = await call('/api/admin/uploads', { session: admin, body: { purpose: 'product_file', target_id: productId, file_name: 'big.pdf', size: 5 * 1024 * 1024, type: 'application/pdf' } })
    assert.equal(big.status, 413)
    const sneaky = await call('/api/admin/uploads', { session: admin, body: { purpose: 'product_file', target_id: productId, file_name: 'small.pdf', size: 100, type: 'application/pdf' } })
    const padded = Buffer.concat([pdf, Buffer.alloc(1024 * 1024)])
    await fetch(sneaky.data.url, { method: 'PUT', body: padded, headers: { 'content-type': 'application/pdf' } })
    const sneakyDone = await call(`/api/admin/uploads/${sneaky.data.id}/complete`, { session: admin, body: {} })
    assert.equal(sneakyDone.status, 413)

    // Tutorials: thumbnail, MP4 video (no conversion on Vercel), and MOV is refused with a clear reason.
    const tut = await call('/api/admin/tutorials', { session: admin, body: { title: 'Binder Setup', slug: 'binder-setup', category: 'np-binder', summary: 'Test', instructions: { type: 'doc', content: [] } } })
    const tutorialId = tut.data.id
    assert.equal((await directUpload(admin, 'tutorial_thumbnail', tutorialId, 'thumb.png', png())).complete!.status, 201)
    const video = await directUpload(admin, 'tutorial_video', tutorialId, 'binder.mp4', readFileSync('src/assets/tutorials/placeholder.mp4'))
    assert.equal(video.complete!.status, 201, JSON.stringify(video.complete!.data))
    assert.equal(video.complete!.data.status, 'ready')
    assert.equal((await one<{ video_status: string }>('select video_status from tutorials where id = $1', [tutorialId]))!.video_status, 'ready')
    const mov = await call('/api/admin/uploads', { session: admin, body: { purpose: 'tutorial_video', target_id: tutorialId, file_name: 'clip.mov', size: 1000, type: 'video/quicktime' } })
    assert.equal(mov.status, 415)
    assert.match(mov.data.error, /MP4/)

    // A browser that reports a failed upload leaves nothing behind.
    const abandoned = await call('/api/admin/uploads', { session: admin, body: { purpose: 'product_image', target_id: productId, file_name: 'x.png', size: 33, type: 'image/png' } })
    await fetch(abandoned.data.url, { method: 'PUT', body: png(), headers: { 'content-type': 'image/png' } })
    await call(`/api/admin/uploads/${abandoned.data.id}/failed`, { session: admin, body: { message: 'Connection lost' } })
    assert.equal((await one<{ status: string }>('select status from storage_uploads where id = $1', [abandoned.data.id]))!.status, 'rejected')
    assert.equal([...supabase.objects.values()].filter((o) => o.path.startsWith(`product-images/${productId}/`)).length, 1)
  })
})

describe('downloads on Vercel', () => {
  it('streams a private file once, never as a signed link, and only to its owner', async () => {
    const { buyer, ent } = await boughtDigital()
    const other = await signUp('other@example.com')
    assert.equal((await call(`/api/downloads/${ent.id}/prepare`, { session: other, method: 'POST' })).status, 404)

    const prep = await call(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    assert.equal(prep.status, 200)
    assert.equal((await call(prep.data.url, { session: other })).status, 404, 'a valid link is useless to anyone else')

    // Many simultaneous requests with the same link: exactly one file.
    const results = await Promise.all(Array.from({ length: 8 }, () => call(prep.data.url, { session: buyer })))
    const ok = results.filter((r) => r.status === 200)
    assert.equal(ok.length, 1)
    assert.equal(Buffer.from(ok[0].data).subarray(0, 5).toString(), '%PDF-')
    assert.equal((await call(prep.data.url, { session: buyer })).status, 410)
    assert.equal((await call(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })).status, 409)

    // No reusable storage link was ever created for a purchasable file.
    assert.equal(supabase.signedReads().filter((id) => id.startsWith('product-files/')).length, 0)
    const { SupabaseStorage } = await import('../lib/storage.js')
    await assert.rejects(new SupabaseStorage().signedUrl('product-files/anything/v1.pdf', 60), /never get signed links/)
  })

  it('a storage outage does not use up the download', async () => {
    const { buyer, ent } = await boughtDigital()
    const prep = await call(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    const saved = new Map(supabase.objects)
    supabase.objects.clear()
    assert.equal((await call(prep.data.url, { session: buyer })).status, 503)
    assert.equal((await one<{ status: string }>('select status from entitlements where id = $1', [ent.id]))!.status, 'available')
    for (const [k, v] of saved) supabase.objects.set(k, v)
    const retry = await call(`/api/downloads/${ent.id}/prepare`, { session: buyer, method: 'POST' })
    assert.equal((await call(retry.data.url, { session: buyer })).status, 200)
  })

  it('a new version uploaded directly gives each buyer exactly one new download', async () => {
    const { buyer, productId } = await boughtDigital()
    const first = await call(`/api/downloads/${(await entitlementsFor(buyer.id))[0].id}/prepare`, { session: buyer, method: 'POST' })
    assert.equal((await call(first.data.url, { session: buyer })).status, 200)

    const admin = await signUp('owner@example.com', 'admin')
    const v2 = await directUpload(admin, 'product_file', productId, 'pages-v2.pdf', Buffer.from(buildSamplePlannerPdf('Version 2')))
    assert.equal(v2.complete!.status, 201)
    const release = { upload_id: v2.complete!.data.id, notes: 'New pages', notify: false, confirm: true, idempotency_key: 'release-v2-key' }
    const r1 = await call(`/api/admin/products/${productId}/releases`, { session: admin, body: release })
    assert.equal(r1.status, 201, JSON.stringify(r1.data))
    const r2 = await call(`/api/admin/products/${productId}/releases`, { session: admin, body: release })
    assert.ok(r2.status < 300, 'retrying the same release is safe')

    const ents = await entitlementsFor(buyer.id)
    assert.deepEqual(ents.map((e) => `${e.source}:${e.status}`), ['purchase:redeemed', 'update:available'])
    const list = await call('/api/account/downloads', { session: buyer })
    assert.equal(list.data.downloads[0].status, 'update_available')
    const prep = await call(`/api/downloads/${ents[1].id}/prepare`, { session: buyer, method: 'POST' })
    const got = await call(prep.data.url, { session: buyer })
    assert.equal(got.status, 200)
    assert.ok(Buffer.from(got.data).toString('latin1').includes('Version 2'))
  })
})

describe('tutorial media on Vercel', () => {
  it('signed media links only for published tutorials; drafts stay private; admins can preview', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const tut = await call('/api/admin/tutorials', { session: admin, body: { title: 'Binder Setup', slug: 'binder-setup', category: 'np-binder', summary: 'Test', instructions: { type: 'doc', content: [] } } })
    const id = tut.data.id
    const mp4 = readFileSync('src/assets/tutorials/placeholder.mp4')
    assert.equal((await directUpload(admin, 'tutorial_video', id, 'binder.mp4', mp4)).complete!.status, 201)

    assert.equal((await call('/api/tutorials/binder-setup/video')).status, 404, 'draft video is not public')
    assert.equal((await call('/api/tutorials/binder-setup')).status, 404)
    const preview = await call(`/api/admin/tutorials/${id}/preview/video`, { session: admin })
    assert.equal(preview.status, 302)
    assert.equal(preview.headers.get('cache-control'), 'private, no-store')

    await call(`/api/admin/tutorials/${id}/publish`, { session: admin, method: 'POST' })
    const pub = await call('/api/tutorials/binder-setup/video')
    assert.equal(pub.status, 302)
    const played = await fetch(pub.headers.get('location')!)
    assert.equal(played.status, 200)
    assert.equal(Buffer.from(await played.arrayBuffer()).length, mp4.length)

    await call(`/api/admin/tutorials/${id}/unpublish`, { session: admin, method: 'POST' })
    assert.equal((await call('/api/tutorials/binder-setup/video')).status, 404, 'no new links once unpublished')
  })

  it('product photos are shown while the product is public, and hidden while it is a draft', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const product = await call('/api/admin/products', { session: admin, body: { title: 'Photo Test', slug: 'photo-test', category: 'np-inserts', type: 'digital', price_cents: 900 } })
    await directUpload(admin, 'product_image', product.data.id, 'cover.png', png())
    const image = await one<{ id: string }>('select id from product_images where product_id = $1', [product.data.id])
    assert.equal((await call(`/api/media/${image!.id}`)).status, 404)
    assert.equal((await call(`/api/media/${image!.id}`, { session: admin })).status, 302)
    await q(`update products set status = 'published', active = true where id = $1`, [product.data.id])
    assert.equal((await call(`/api/media/${image!.id}`)).status, 302)
  })
})

describe('webhooks through the Vercel function', () => {
  it('verifies Stripe and Resend signatures on the raw body, without the staging password', async () => {
    const sent: string[] = []
    setSender(async (m) => {
      sent.push(m.to)
      return { id: `re_vercel_${sent.length}` }
    })
    const buyer = await signUp('buyer@example.com')
    const productId = await digitalProduct('np-webhook')
    const order = await pendingOrder(buyer, [{ productId }])
    const payload = JSON.stringify(checkoutCompleted(order.id, order.subtotal))
    const post = (path: string, body: string, headers: Record<string, string>) => fn.POST(new Request(`${ORIGIN}/api?__path=${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))

    assert.equal((await post('webhooks/stripe', payload, { 'stripe-signature': 't=1,v1=forged' })).status, 400)
    assert.equal((await entitlementsFor(buyer.id)).length, 0)
    const signed = await post('webhooks/stripe', payload, { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) })
    assert.equal(signed.status, 200, await signed.clone().text())
    assert.equal((await entitlementsFor(buyer.id)).length, 1)

    await drainOutbox()
    const email = await one<{ resend_id: string }>(`select resend_id from emails where related_order_id = $1 and type = 'order_confirmation'`, [order.id])
    const event = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: email!.resend_id, to: ['buyer@example.com'] } })
    const ts = new Date()
    const sig = new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign('msg_vercel_1', ts, event)
    const svix = { 'svix-id': 'msg_vercel_1', 'svix-timestamp': String(Math.floor(ts.getTime() / 1000)) }
    assert.equal((await post('webhooks/resend', event, { ...svix, 'svix-signature': 'v1,forged' })).status, 400)
    assert.equal((await post('webhooks/resend', event, { ...svix, 'svix-signature': sig })).status, 200)
    assert.equal((await one<{ status: string }>(`select status from emails where resend_id = $1`, [email!.resend_id]))!.status, 'delivered')
  })
})

describe('email and scheduled maintenance on Vercel', () => {
  it('the scheduled job needs its secret, retries emails a stopped instance left behind, and never sends twice', async () => {
    const sent: string[] = []
    setSender(async (m) => {
      sent.push(m.idempotencyKey)
      return { id: `re_${sent.length}` }
    })
    await q(`insert into emails (type, to_email, subject, html, idempotency_key, status, attempts, claimed_at) values
      ('order_confirmation','stuck@example.com','Order','<p>x</p>','stuck-key','sending',1, now() - interval '10 minutes'),
      ('order_confirmation','fresh@example.com','Order','<p>x</p>','fresh-key','sending',1, now()),
      ('order_confirmation','queued@example.com','Order','<p>x</p>','queued-key','queued',0, null)`)

    const cron = (auth?: string) => fn.GET(new Request(`${ORIGIN}/api?__path=cron/maintenance`, { headers: auth ? { authorization: auth } : {} }))
    assert.equal((await cron()).status, 401)
    assert.equal((await cron('Bearer wrong-secret-wrong-secret!!')).status, 401)
    const ran = await cron(`Bearer ${process.env.CRON_SECRET}`)
    assert.equal(ran.status, 200)
    await (await cron(`Bearer ${process.env.CRON_SECRET}`)).text()

    const rows = await q<{ idempotency_key: string; status: string }>('select idempotency_key, status from emails order by idempotency_key')
    assert.deepEqual(rows.map((r) => `${r.idempotency_key}:${r.status}`), ['fresh-key:sending', 'queued-key:sent', 'stuck-key:sent'])
    assert.deepEqual(sent.sort(), ['queued-key', 'stuck-key'], 'each email went to Resend once, with its idempotency key')
  })
})
