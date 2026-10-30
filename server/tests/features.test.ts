import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import sharp from 'sharp'
import { pickResult, type QuizContent } from '../../shared/quiz.js'
import { storage } from '../lib/storage.js'
import { watermarkPreview } from '../lib/watermark.js'
import { api, digitalProduct, entitlementsFor, one, payOrder, pendingOrder, q, setup, signUp, teardown } from './helpers.js'

beforeEach(setup)
after(teardown)

const admin = () => signUp('owner@example.com', 'admin')

async function boughtBy(email: string, productId: string) {
  const buyer = await signUp(email)
  const order = await pendingOrder(buyer, [{ productId }])
  await payOrder(order.id, order.subtotal)
  return { buyer, order }
}

/* ---------- Quiz ---------- */

function quiz(products: { a: string; b: string }): QuizContent {
  return {
    title: 'Find your resources',
    intro: 'A few quick questions about where you are in your nursing journey.',
    ctaLabel: 'Browse all resources',
    fallbackResultId: 'general',
    results: [
      { id: 'student', title: 'Nursing student picks', description: 'For school.', productIds: [products.a], collections: [], tutorialIds: [], freebieCorner: true, priority: 2 },
      { id: 'np', title: 'NP student picks', description: 'For NP school.', productIds: [products.b], collections: ['np-inserts'], tutorialIds: [], freebieCorner: false, priority: 1 },
      { id: 'general', title: 'Start here', description: 'Our favorites.', productIds: [products.a], collections: ['nurse-inserts'], tutorialIds: [], freebieCorner: true, priority: 3 },
    ],
    questions: [
      {
        id: 'q1',
        text: 'Where are you in your journey?',
        helper: '',
        type: 'single',
        required: true,
        answers: [
          { id: 'a1', label: 'Nursing school', points: { student: 2 } },
          { id: 'a2', label: 'NP school', points: { np: 2 } },
          { id: 'a3', label: 'Just browsing', points: {} },
        ],
      },
      {
        id: 'q2',
        text: 'What would help most?',
        helper: 'Choose all that apply.',
        type: 'multiple',
        required: false,
        answers: [
          { id: 'b1', label: 'Study pages', points: { student: 1, np: 1 } },
          { id: 'b2', label: 'Clinical organization', points: { np: 1 } },
        ],
      },
    ],
  }
}

describe('resource quiz', () => {
  it('scores answers, breaks ties by priority, and falls back safely', () => {
    const c = quiz({ a: '11111111-1111-1111-1111-111111111111', b: '22222222-2222-2222-2222-222222222222' })
    assert.equal(pickResult(c, { q1: ['a1'] }).result?.id, 'student')
    assert.equal(pickResult(c, { q1: ['a2'], q2: ['b2'] }).result?.id, 'np')
    // student 2+1 = 3, np 1+1 = 2? Make it a tie: a1 (student 2) + b2 (np 1) + b1 (both 1) => student 3, np 2.
    assert.equal(pickResult(c, { q1: ['a1'], q2: ['b1', 'b2'] }).result?.id, 'student')
    // Tie: b1 only gives student 1 and np 1; np has the lower priority number.
    assert.equal(pickResult(c, { q2: ['b1'] }).result?.id, 'np')
    // No points at all: fallback.
    const none = pickResult(c, { q1: ['a3'] })
    assert.deepEqual([none.result?.id, none.usedFallback], ['general', true])
    // Winner with nothing available to show: fallback.
    assert.equal(pickResult(c, { q1: ['a1'] }, (r) => r.id !== 'student').result?.id, 'general')
  })

  it('builds, validates, publishes, keeps edits as drafts, and shows only active products', async () => {
    const a = await admin()
    const shopper = await signUp('shopper@example.com')
    assert.equal((await api('/api/admin/quizzes', { session: shopper })).status, 403)
    const live = await digitalProduct('np-live-pages')
    const hidden = await digitalProduct('np-hidden-pages')
    await q(`update products set active = false where id = $1`, [hidden])

    const created = await api('/api/admin/quizzes', { session: a, body: { name: 'Spring quiz' } })
    assert.equal(created.status, 201)
    const id = created.data.id
    const blocked = await api(`/api/admin/quizzes/${id}/publish`, { session: a, method: 'POST' })
    assert.equal(blocked.status, 400)
    assert.match(blocked.data.error, /Add a quiz title/)

    // A result whose only product is inactive cannot be published.
    const c = quiz({ a: live, b: hidden })
    c.results[1].collections = []
    await api(`/api/admin/quizzes/${id}`, { session: a, method: 'PUT', body: { name: 'Spring quiz', draft: c } })
    const noProducts = await api(`/api/admin/quizzes/${id}/publish`, { session: a, method: 'POST' })
    assert.equal(noProducts.status, 400)
    assert.match(noProducts.data.error, /NP student picks.*published product or a collection/)

    c.results[1].collections = ['np-inserts']
    const saved = await api(`/api/admin/quizzes/${id}`, { session: a, method: 'PUT', body: { name: 'Spring quiz', draft: c } })
    assert.deepEqual(saved.data.problems, [])
    assert.deepEqual(saved.data.draft.questions[0].answers.map((x: { id: string }) => x.id), ['a1', 'a2', 'a3'], 'answer order is kept')
    assert.equal((await api('/api/quiz')).data.quiz, null, 'nothing public before publishing')
    assert.equal((await api(`/api/admin/quizzes/${id}/publish`, { session: a, method: 'POST' })).status, 200)

    const pub = (await api('/api/quiz')).data.quiz
    assert.equal(pub.content.title, 'Find your resources')
    assert.deepEqual(pub.products.map((p: { id: string }) => p.id), [live], 'inactive products are never sent')
    assert.equal(JSON.stringify(pub).includes('product-files/'), false)

    // Editing a published quiz stays a draft until published again.
    c.title = 'Half edited title'
    await api(`/api/admin/quizzes/${id}`, { session: a, method: 'PUT', body: { name: 'Spring quiz', draft: c } })
    assert.equal((await api('/api/quiz')).data.quiz.content.title, 'Find your resources')
    assert.equal((await api(`/api/admin/quizzes/${id}`, { session: a })).data.unpublishedChanges, true)
    await api(`/api/admin/quizzes/${id}/publish`, { session: a, method: 'POST' })
    const v2 = (await api('/api/quiz')).data.quiz
    assert.deepEqual([v2.content.title, v2.version], ['Half edited title', 2])

    // Only one storefront quiz; archive needs unpublishing first.
    const copy = await api(`/api/admin/quizzes/${id}/duplicate`, { session: a, method: 'POST' })
    await api(`/api/admin/quizzes/${copy.data.id}/publish`, { session: a, method: 'POST' })
    assert.equal((await api('/api/quiz')).data.quiz.id, copy.data.id)
    assert.equal((await one<{ status: string }>('select status from quizzes where id = $1', [id]))!.status, 'draft')
    assert.equal((await api(`/api/admin/quizzes/${copy.data.id}/archive`, { session: a, method: 'POST' })).status, 400)
    await api(`/api/admin/quizzes/${copy.data.id}/unpublish`, { session: a, method: 'POST' })
    assert.equal((await api('/api/quiz')).data.quiz, null)
    assert.ok(await one(`select 1 from audit_log where action = 'quiz.published'`))
  })

  it('counts starts, completions and product clicks without storing answers', async () => {
    const a = await admin()
    const p = await digitalProduct('quiz-stat-pages')
    const id = (await api('/api/admin/quizzes', { session: a, body: { name: 'Q', draft: quiz({ a: p, b: p }) } })).data.id
    await api(`/api/admin/quizzes/${id}/publish`, { session: a, method: 'POST' })
    for (const event of ['start', 'start', 'complete', 'product_click']) await api('/api/quiz/events', { body: { quiz_id: id, version: 1, event } })
    assert.equal((await api('/api/quiz/events', { body: { quiz_id: id, version: 7, event: 'start' } })).data.counted, false)
    const listed = (await api('/api/admin/quizzes', { session: a })).data.quizzes[0]
    assert.deepEqual(listed.stats, { starts: 2, completions: 1, productClicks: 1 })
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'quiz_stats' order by ordinal_position`)).map((r) => r.column_name)
    assert.deepEqual(cols, ['quiz_id', 'version', 'day', 'starts', 'completions', 'product_clicks'])
  })
})

/* ---------- Nurse Kin launcher ---------- */

describe('Nurse Kin launcher', () => {
  it('stays hidden until the label, copy and real address are published', async () => {
    const a = await admin()
    const body = { launcher_label: 'Meet Nurse Kin', headline: 'Meet Nurse Kin', body: 'Owner approved description.', cta_label: 'Visit Nurse Kin', url: 'https://nursekin.example' }
    await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body: { ...body, launcher_label: '' } })
    const blocked = await api('/api/admin/marketing/popup/publish', { session: a, method: 'POST' })
    assert.equal(blocked.status, 400)
    assert.match(blocked.data.error, /launcher label/)
    assert.equal((await api('/api/marketing')).data.popup, null)
    await api('/api/admin/marketing/popup', { session: a, method: 'PUT', body })
    await api('/api/admin/marketing/popup/publish', { session: a, method: 'POST' })
    const pub = (await api('/api/marketing')).data.popup
    assert.deepEqual([pub.launcherLabel, pub.url, pub.ctaLabel], ['Meet Nurse Kin', 'https://nursekin.example/', 'Visit Nurse Kin'])
    assert.equal('delaySeconds' in pub, false, 'no automatic popup timing exists anymore')
  })
})

/* ---------- Reviews ---------- */

describe('verified purchase reviews', () => {
  const review = (extra: Record<string, unknown> = {}) => ({ rating: 4, title: 'Really helpful pages', body: 'These kept my clinical notes organized all semester.', display_name: 'Maria V.', ...extra })

  it('only buyers can review; one review each; moderation before anything is public; privacy kept', async () => {
    const a = await admin()
    const productId = await digitalProduct('np-review-pages')
    const stranger = await signUp('stranger@example.com')
    assert.equal((await api(`/api/account/reviews/${productId}`, { session: stranger, method: 'PUT', body: review() })).status, 403)

    const { buyer } = await boughtBy('buyer@example.com', productId)
    const before = await entitlementsFor(buyer.id)
    assert.equal((await api(`/api/account/reviews/${productId}`, { session: buyer, method: 'PUT', body: review({ display_name: 'buyer@example.com' }) })).status, 400, 'no emails as display names')
    const first = await api(`/api/account/reviews/${productId}`, { session: buyer, method: 'PUT', body: review() })
    assert.deepEqual([first.status, first.data.status, first.data.created], [200, 'pending', true])
    assert.equal((await api('/api/products/np-review-pages/reviews')).data.count, 0, 'pending reviews are not public')

    await api(`/api/admin/reviews/${first.data.id}`, { session: a, body: { action: 'publish' } })
    const pub = (await api('/api/products/np-review-pages/reviews')).data
    assert.deepEqual([pub.count, pub.average, pub.reviews[0].displayName, pub.reviews[0].verified], [1, 4, 'Maria V.', true])
    const text = JSON.stringify(pub)
    for (const secret of ['buyer@example.com', 'Test Person', 'NLC-', buyer.id]) assert.equal(text.includes(secret), false, `public reviews never include ${secret}`)

    // Submitting again edits the same review (no duplicates) and sends it back for approval.
    const again = await api(`/api/account/reviews/${productId}`, { session: buyer, method: 'PUT', body: review({ rating: 5, title: 'Even better after a month' }) })
    assert.deepEqual([again.data.id, again.data.created], [first.data.id, false])
    assert.equal((await q('select 1 from reviews where user_id = $1', [buyer.id])).length, 1)
    assert.equal((await api('/api/products/np-review-pages/reviews')).data.count, 0)
    await api(`/api/admin/reviews/${first.data.id}`, { session: a, body: { action: 'publish' } })
    await api(`/api/admin/reviews/${first.data.id}`, { session: a, body: { action: 'reply', reply: 'Thank you so much!' } })
    const replied = (await api('/api/products/np-review-pages/reviews')).data.reviews[0]
    assert.deepEqual([replied.rating, replied.ownerReply], [5, 'Thank you so much!'])

    // Reviews never touch downloads.
    assert.deepEqual(await entitlementsFor(buyer.id), before)
  })

  it('reports keep the review visible; rejection needs a reason; averages use published reviews only; everything is audited', async () => {
    const a = await admin()
    const productId = await digitalProduct('np-report-pages')
    const one1 = await boughtBy('one@example.com', productId)
    const two = await boughtBy('two@example.com', productId)
    const r1 = (await api(`/api/account/reviews/${productId}`, { session: one1.buyer, method: 'PUT', body: review({ rating: 2, title: 'Not for me', body: 'The layout did not fit how I chart, sadly.' }) })).data.id
    const r2 = (await api(`/api/account/reviews/${productId}`, { session: two.buyer, method: 'PUT', body: review({ rating: 5 }) })).data.id
    await api(`/api/admin/reviews/${r1}`, { session: a, body: { action: 'publish' } })
    assert.equal((await api('/api/products/np-report-pages/reviews')).data.average, 2, 'pending reviews do not count')
    assert.equal((await api(`/api/admin/reviews/${r2}`, { session: a, body: { action: 'reject' } })).status, 400, 'a reason is required')
    await api(`/api/admin/reviews/${r2}`, { session: a, body: { action: 'reject', reason: 'not_about_product' } })

    assert.equal((await api(`/api/reviews/${r1}/report`, { body: { reason: 'abuse' } })).status, 200)
    assert.equal((await api('/api/products/np-report-pages/reviews')).data.count, 1, 'a report alone never hides criticism')
    const reported = (await api('/api/admin/reviews?status=reported', { session: a })).data
    assert.deepEqual([reported.reviews.length, reported.reviews[0].report_reasons], [1, ['abuse']])
    await api(`/api/admin/reviews/${r1}`, { session: a, body: { action: 'clear_reports' } })
    assert.equal((await api('/api/admin/reviews?status=reported', { session: a })).data.reviews.length, 0)
    const actions = (await q<{ action: string }>(`select action from audit_log where entity_type = 'review' order by id`)).map((x) => x.action)
    assert.deepEqual(actions, ['review.publish', 'review.reject', 'review.clear_reports'])
  })

  it('refunds: the review stays, loses "Verified purchase", and can no longer be edited', async () => {
    const a = await admin()
    const productId = await digitalProduct('np-refund-pages')
    const { buyer, order } = await boughtBy('refund@example.com', productId)
    const id = (await api(`/api/account/reviews/${productId}`, { session: buyer, method: 'PUT', body: review() })).data.id
    await api(`/api/admin/reviews/${id}`, { session: a, body: { action: 'publish' } })
    await q(`update order_items set refunded_quantity = quantity where order_id = $1`, [order.id])
    await q(`update orders set status = 'refunded' where id = $1`, [order.id])
    const pub = (await api('/api/products/np-refund-pages/reviews')).data
    assert.deepEqual([pub.count, pub.reviews[0].verified], [1, false])
    assert.equal((await api(`/api/account/reviews/${productId}`, { session: buyer, method: 'PUT', body: review({ rating: 1 }) })).status, 403)
    assert.equal((await api(`/api/account/reviews/${productId}`, { session: buyer })).data.eligible, false)
  })
})

/* ---------- Our Story ---------- */

async function png(width: number, height: number, color = '#f6c9d6') {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

describe('Our Story', () => {
  it('stays private until her own content is published; drafts never leak', async () => {
    const a = await admin()
    assert.equal((await api('/api/content/our-story')).data.story, null)
    const fields = { founderName: 'Owner Name', professionalTitle: 'Registered Nurse', introduction: 'Owner supplied introduction.', homeExcerpt: 'Owner supplied excerpt. Two sentences.', portraitAlt: 'Portrait of the founder', nurseKinUrl: 'http://insecure.example' }
    assert.equal((await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: fields })).status, 400, 'links must be https')
    const saved = await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { ...fields, nurseKinUrl: '' } })
    assert.deepEqual(saved.data.problems, ['Add a portrait.'])
    assert.equal((await api('/api/admin/content/our-story/publish', { session: a, method: 'POST' })).status, 400)
    const up = await api('/api/admin/content/our-story/portrait', { session: a, body: await png(600, 800), headers: { 'content-type': 'image/png', 'x-file-name': 'portrait.png' } })
    assert.equal(up.status, 201, JSON.stringify(up.data))
    assert.equal((await api('/api/content/our-story/portrait')).status, 404, 'unpublished portrait is private')
    await api('/api/admin/content/our-story/publish', { session: a, method: 'POST' })
    const story = (await api('/api/content/our-story')).data.story
    assert.deepEqual([story.founderName, story.homeExcerpt], ['Owner Name', 'Owner supplied excerpt. Two sentences.'])
    assert.equal((await api(story.portraitUrl)).status, 200)
    assert.equal('portraitKey' in story, false)

    await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { ...fields, nurseKinUrl: '', introduction: 'Unfinished new intro' } })
    assert.equal((await api('/api/content/our-story')).data.story.introduction, 'Owner supplied introduction.', 'draft edits stay private')
    await api('/api/admin/content/our-story/unpublish', { session: a, method: 'POST' })
    assert.equal((await api('/api/content/our-story')).data.story, null)
  })

  it('starter wording fills only never saved fields; favorites and Nurse Kin show only when real', async () => {
    const a = await admin()
    // Content saved before the redesign (no newer fields), published as it was.
    const old = { founderName: 'Owner Name', introduction: 'Her intro.', homeExcerpt: 'Short.', portraitKey: 'content/our-story/x', portraitType: 'image/jpeg', portraitAlt: 'Portrait', closing: 'Her own closing.', background: 'Her background.', nurseKinText: 'About Kin.', nurseKinUrl: 'https://example.com/' }
    await q(`insert into site_content (key, draft, published, published_at) values ('our_story', $1, $1, now())`, [JSON.stringify(old)])
    const pub = (await api('/api/content/our-story')).data.story
    assert.equal(pub.greeting, '', 'no starter wording reaches visitors')
    assert.equal(pub.background, 'Her background.')
    assert.equal(pub.showFullStory, true, 'longer sections published earlier stay visible')
    assert.deepEqual([pub.nurseKinText, pub.nurseKinUrl], ['', ''], 'placeholder Nurse Kin link is never shown')

    const ed = (await api('/api/admin/content/our-story', { session: a })).data
    assert.match(ed.draft.greeting, /^Hi, I’m Lada!/)
    assert.equal(ed.draft.features.length, 3)
    assert.equal(ed.draft.closing, 'Her own closing.', 'earlier closing kept')
    assert.equal(ed.draft.background, 'Her background.')
    assert.ok(ed.problems.some((p: string) => /placeholder Nurse Kin/.test(p)))
    assert.ok(!/—|–/.test(JSON.stringify(ed.draft)), 'starter wording has no dashes')
    assert.equal(ed.unpublishedChanges, true)

    // Saving one field keeps the rest; clearing the greeting keeps it cleared.
    const saved = await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { greeting: '' } })
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    assert.equal(saved.data.draft.greeting, '')
    assert.equal(saved.data.draft.introduction, 'Her intro.')
    assert.equal(saved.data.draft.storeHeading, 'A little shop. A lot of nurse love.')
    assert.equal((await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { shopLink: 'javascript:alert(1)' } })).status, 400)
    assert.equal((await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { favoriteIds: ['not-an-id'] } })).status, 400)

    // Favorites: up to three, only published products for sale, in her order.
    const p1 = await digitalProduct('fav-one')
    const p2 = await digitalProduct('fav-two')
    const draftOnly = await digitalProduct('fav-draft')
    await q(`update products set status = 'draft' where id = $1`, [draftOnly])
    assert.equal((await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { favoriteIds: [p1, p2, draftOnly, p1] } })).status, 200, 'duplicates collapse')
    await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { nurseKinUrl: '', nurseKinText: '' } })
    assert.equal((await api('/api/admin/content/our-story/publish', { session: a, method: 'POST' })).status, 200)
    let story = (await api('/api/content/our-story')).data.story
    assert.deepEqual(story.favoriteIds, [], 'hidden until enabled')
    assert.equal(story.storeHeading, 'A little shop. A lot of nurse love.', 'previewed starter wording goes live on publish')
    await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { favoritesEnabled: true, favoriteIds: [p2, draftOnly, p1] } })
    await api('/api/admin/content/our-story/publish', { session: a, method: 'POST' })
    story = (await api('/api/content/our-story')).data.story
    assert.deepEqual(story.favoriteIds, [p2, p1], 'unpublished favorite hidden')
    assert.equal('favoritesEnabled' in story, false)
    await q(`update products set active = false where id = $1`, [p2])
    assert.deepEqual((await api('/api/content/our-story')).data.story.favoriteIds, [p1], 'unavailable favorite drops out')
    assert.equal((await api('/api/admin/content/our-story', { session: a, method: 'PUT', body: { favoriteIds: [p1, p2, draftOnly, await digitalProduct('fav-four')] } })).status, 400)
  })
})

/* ---------- Product previews ---------- */

describe('limited product previews', () => {
  it('watermarks small crops and wide details too', async () => {
    for (const [w, h] of [[60, 40], [300, 80], [80, 600]]) {
      const out = await watermarkPreview(await png(w, h, '#ffffff'), 'image/png')
      assert.equal(out.width, w)
      assert.equal(out.height, h)
    }
  })

  it('samples are watermarked, reduced, approved before showing, and never expose the paid file', async () => {
    const a = await admin()
    const productId = await digitalProduct('np-preview-pages')
    const { buyer } = await boughtBy('previewer@example.com', productId)
    const before = await entitlementsFor(buyer.id)

    const original = await png(2400, 3000, '#ffffff')
    const up = await api(`/api/admin/products/${productId}/images?kind=sample`, { session: a, body: original, headers: { 'content-type': 'image/png', 'x-file-name': 'page-3.png' } })
    assert.equal(up.status, 201, JSON.stringify(up.data))
    assert.equal(up.data.approved, false)
    const img = (await one<{ storage_key: string; width: number; height: number }>('select storage_key, width, height from product_images where id = $1', [up.data.id]))!
    assert.ok(img.storage_key.includes('/preview-'))
    assert.ok(img.width <= 1400 && img.height <= 1400, 'previews are reduced, never full resolution')
    // The watermark is in the pixels: a plain white page is no longer plain white.
    const opened = await storage().open(img.storage_key)
    const chunks: Buffer[] = []
    for await (const ch of opened.stream) chunks.push(ch as Buffer)
    const stats = await sharp(Buffer.concat(chunks)).stats()
    assert.ok(stats.channels[1].min < 200, 'watermark pixels are flattened into the image')

    // Not approved: invisible publicly, visible to the admin.
    assert.equal((await api(`/api/media/${up.data.id}`)).status, 404)
    assert.equal((await api(`/api/products/np-preview-pages`)).data.product.images.filter((i: { kind: string }) => i.kind === 'sample').length, 0)
    assert.equal((await api(`/api/media/${up.data.id}`, { session: a })).status, 200)
    await api(`/api/admin/products/${productId}/images/${up.data.id}/approval`, { session: a, body: { approved: true } })
    assert.equal((await api(`/api/media/${up.data.id}`)).status, 200)

    // A product photo can never be relabeled as a sample (it was not watermarked).
    const photo = await api(`/api/admin/products/${productId}/images?kind=gallery`, { session: a, body: await png(800, 600), headers: { 'content-type': 'image/png', 'x-file-name': 'photo.png' } })
    await api(`/api/admin/products/${productId}/images`, { session: a, method: 'PUT', body: { images: [{ id: photo.data.id, alt: '', kind: 'sample' }] } })
    assert.equal((await one<{ kind: string }>('select kind from product_images where id = $1', [photo.data.id]))!.kind, 'gallery')

    // What's included is live text; the walkthrough only shows when its tutorial is published.
    const t = await api('/api/admin/tutorials', { session: a, body: { title: 'Walkthrough', slug: 'np-walkthrough', category: 'np-binder', summary: 'x', instructions: { type: 'doc', content: [] } } })
    const detail = (await api(`/api/admin/products/${productId}`, { session: a })).data.product
    const put = await api(`/api/admin/products/${productId}`, { session: a, method: 'PUT', body: { ...detail, whats_included: ['12 clinical log pages', 'Medication tracker'], walkthrough_tutorial_id: t.data.id } })
    assert.equal(put.status, 200, JSON.stringify(put.data))
    const pub = (await api('/api/products/np-preview-pages')).data.product
    assert.deepEqual(pub.whatsIncluded, ['12 clinical log pages', 'Medication tracker'])
    assert.equal(pub.walkthrough, null, 'draft tutorial is not linked publicly')

    // No public response ever references the private paid file.
    const publicText = JSON.stringify([pub, (await api('/api/catalog')).data, (await api('/api/products/np-preview-pages/reviews')).data])
    assert.equal(publicText.includes('product-files/'), false)
    const version = await one<{ storage_key: string }>('select storage_key from product_versions where product_id = $1', [productId])
    assert.equal(publicText.includes(version!.storage_key), false)

    // Viewing previews never changes downloads.
    assert.deepEqual(await entitlementsFor(buyer.id), before)
  })
})
