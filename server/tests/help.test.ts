import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { parseAnswer } from '../../shared/faq.js'
import { api, q, setup, signUp, teardown } from './helpers.js'

const approve = (draft: any, ids: string[]) => ({
  ...draft,
  categories: draft.categories.map((c: any) => ({ ...c, questions: c.questions.map((x: any) => (ids.includes(x.id) ? { ...x, approved: true } : x)) })),
})

describe('help and FAQs', () => {
  beforeEach(setup)
  after(teardown)

  it('starter answers load as admin drafts; nothing is public until approved and published', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    assert.equal((await api('/api/content/help')).data.help, null)
    assert.equal((await api('/api/admin/content/help', { session: buyer })).status, 403)
    const d = (await api('/api/admin/content/help', { session: admin })).data
    assert.equal(d.counts.questions, 28)
    assert.equal(d.counts.approved, 0)
    assert.ok(d.counts.needsConfirmation >= 8)
    assert.equal(d.draft.heading, 'A little help, a lot of nurse love')

    // Publishing with nothing approved shows no questions and no placeholder contact details.
    await api('/api/admin/content/help/publish', { session: admin, body: {} })
    const empty = (await api('/api/content/help')).data.help
    assert.deepEqual(empty.categories, [])
    assert.deepEqual(empty.contact, {})
    const raw = JSON.stringify(empty)
    assert.ok(!/OWNER TO CONFIRM|SUPPORT EMAIL|ownerNote|needsConfirmation/.test(raw))
  })

  it('placeholders block approval; only approved questions publish; later edits stay drafts', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const draft = (await api('/api/admin/content/help', { session: admin })).data.draft
    const blocked = await api('/api/admin/content/help', { session: admin, method: 'PUT', body: approve(draft, ['where-ship']) })
    assert.equal(blocked.status, 400)
    assert.match(blocked.data.error, /placeholder/)

    const ok = await api('/api/admin/content/help', { session: admin, method: 'PUT', body: { ...approve(draft, ['binder-inserts', 'find-files']), contact: { email: 'help@example.com', hours: 'Monday to Friday, 9 to 5', timezone: '[TIMEZONE]', responseTime: '' } } })
    assert.equal(ok.status, 200, JSON.stringify(ok.data))
    assert.equal((await api('/api/content/help')).data.help, null, 'saving a draft publishes nothing')
    await api('/api/admin/content/help/publish', { session: admin, body: {} })
    const pub = (await api('/api/content/help')).data.help
    assert.deepEqual(pub.categories.map((c: any) => [c.title, c.questions.map((x: any) => x.id)]), [
      ['Choosing your resources', ['binder-inserts']],
      ['Digital downloads', ['find-files']],
    ])
    assert.deepEqual(pub.contact, { email: 'help@example.com', hours: 'Monday to Friday, 9 to 5' }, 'unfinished contact fields hidden')
    assert.ok(!('approved' in pub.categories[0].questions[0]) && !('ownerNote' in pub.categories[0].questions[0]))

    // An edit to a published answer stays a draft until published again.
    const d2 = (await api('/api/admin/content/help', { session: admin })).data.draft
    d2.categories[0].questions[0].answer = 'Changed in draft.'
    await api('/api/admin/content/help', { session: admin, method: 'PUT', body: d2 })
    assert.match((await api('/api/content/help')).data.help.categories[0].questions[0].answer, /^Binder inserts are printable/)
    assert.equal((await api('/api/admin/content/help', { session: admin })).data.unpublishedChanges, true)

    await api('/api/admin/content/help/unpublish', { session: admin, body: {} })
    assert.equal((await api('/api/content/help')).data.help, null)
    assert.ok(await q(`select 1 from audit_log where action = 'content.help_unpublish'`))
  })

  it('validates links and markup, and shows the quiz sentence only while a quiz is published', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const draft = (await api('/api/admin/content/help', { session: admin })).data.draft
    const bad = structuredClone(draft)
    bad.categories[0].questions[0].answer = 'See [this](javascript:alert(1)).'
    assert.equal((await api('/api/admin/content/help', { session: admin, method: 'PUT', body: bad })).status, 400)
    bad.categories[0].questions[0].answer = 'Hi <script>x</script>'
    assert.equal((await api('/api/admin/content/help', { session: admin, method: 'PUT', body: bad })).status, 400)

    await api('/api/admin/content/help', { session: admin, method: 'PUT', body: approve(draft, ['choose-right']) })
    await api('/api/admin/content/help/publish', { session: admin, body: {} })
    let answer = (await api('/api/content/help')).data.help.categories[0].questions[0].answer
    assert.ok(!/Find my resources/.test(answer), 'no quiz published: the quiz sentence is hidden')
    await q(`insert into quizzes (name, status, draft, published, version) values ('Q', 'published', '{}', '{}', 1)`)
    answer = (await api('/api/content/help')).data.help.categories[0].questions[0].answer
    assert.match(answer, /\[Find my resources\]\(#find-my-resources\)/)
    const parts = parseAnswer(answer)
    assert.equal(parts[1].condition, 'quiz')
    assert.deepEqual(parts[0].parts[1], { type: 'link', label: 'Nurse Binder Inserts', href: '#nurse-binder-inserts' })
  })

  it('reordering and moving questions between categories is saved', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const draft = (await api('/api/admin/content/help', { session: admin })).data.draft
    const [first, second] = draft.categories
    const moved = first.questions.shift()
    second.questions.unshift(moved)
    draft.categories = [second, first, ...draft.categories.slice(2)]
    const r = await api('/api/admin/content/help', { session: admin, method: 'PUT', body: draft })
    assert.equal(r.status, 200)
    assert.equal(r.data.draft.categories[0].id, 'downloads')
    assert.equal(r.data.draft.categories[0].questions[0].id, 'binder-inserts')
  })
})

describe('product duplicate', () => {
  beforeEach(setup)
  after(teardown)

  it('copies a product as an unfeatured draft, keeping preview approvals', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const created = await api('/api/admin/products', { session: admin, body: { title: 'Planner', slug: 'planner', category: 'np-inserts', type: 'digital', price_cents: 900, featured: true, is_freebie: false } })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    await q(`update products set status = 'published', featured = true where id = $1`, [created.data.id])
    await q(`insert into product_images (product_id, kind, storage_key, content_type, alt, approved) values ($1,'sample','k1','image/png','',false)`, [created.data.id])
    const dup = await api(`/api/admin/products/${created.data.id}/duplicate`, { session: admin, method: 'POST' })
    assert.equal(dup.status, 201, JSON.stringify(dup.data))
    const copy = (await q<{ title: string; slug: string; status: string; featured: boolean; price_cents: number }>('select title, slug, status, featured, price_cents from products where id = $1', [dup.data.id]))[0]
    assert.deepEqual(copy, { title: 'Planner (copy)', slug: 'planner-copy', status: 'draft', featured: false, price_cents: 900 })
    assert.deepEqual((await q<{ approved: boolean }>('select approved from product_images where product_id = $1', [dup.data.id])).map((i) => i.approved), [false])
  })
})

describe('policies', () => {
  beforeEach(setup)
  after(teardown)

  const fillAll = (draft: any) => ({
    ...draft,
    sections: draft.sections.map((s: any) => ({
      ...s,
      body: s.body.replace(/\[(?:[A-Z][A-Z0-9 ,&'/-]{2,}|OWNER TO [A-Z ]+:[^\]]*)\]/g, 'Owner supplied text'),
      reviewed: true,
    })),
  })

  it('starter drafts describe the store, stay private, and cannot publish with placeholders or unreviewed sections', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    assert.equal((await api('/api/content/policies/terms')).data.policy, null)
    assert.equal((await api('/api/content/policies/nope')).status, 400)
    assert.equal((await api('/api/admin/content/policies/terms', { session: buyer })).status, 403)
    const d = (await api('/api/admin/content/policies/privacy', { session: admin })).data
    assert.equal(d.title, 'Privacy Policy')
    assert.ok(d.problems.some((p: string) => /PLACEHOLDER/.test(p)))
    assert.ok(d.problems.some((p: string) => /not marked reviewed/.test(p)))
    assert.ok(d.services.payments, 'connected services are shown to the owner')
    const text = JSON.stringify(d.draft)
    assert.match(text, /answers are not stored/)
    assert.ok(!/—|–/.test(text), 'no dashes in starter wording')

    const blocked = await api('/api/admin/content/policies/privacy/publish', { session: admin, method: 'POST', body: {} })
    assert.equal(blocked.status, 400)
    assert.equal((await api('/api/content/policies/privacy')).data.policy, null)

    // Reviewed but a placeholder is left: still blocked.
    const almost = fillAll(d.draft)
    almost.sections[0].body = 'Run by [BUSINESS LEGAL NAME].'
    await api('/api/admin/content/policies/privacy', { session: admin, method: 'PUT', body: almost })
    assert.equal((await api('/api/admin/content/policies/privacy/publish', { session: admin, method: 'POST', body: {} })).status, 400)
  })

  it('publishes a dated snapshot without owner notes; later edits stay drafts; unpublish hides it', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const draft = (await api('/api/admin/content/policies/terms', { session: admin })).data.draft
    const saved = await api('/api/admin/content/policies/terms', { session: admin, method: 'PUT', body: fillAll(draft) })
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    assert.deepEqual(saved.data.problems, [])
    assert.equal((await api('/api/content/policies/terms')).data.policy, null, 'saving publishes nothing')
    assert.equal((await api('/api/admin/content/policies/terms/publish', { session: admin, method: 'POST', body: {} })).status, 200)
    const pub = (await api('/api/content/policies/terms')).data.policy
    assert.ok(Date.parse(pub.lastUpdated) > Date.now() - 60_000)
    assert.ok(pub.sections.length > 5)
    assert.ok(!/ownerNote|reviewed/.test(JSON.stringify(pub)))
    assert.equal((await api('/api/content/policies/privacy')).data.policy, null, 'each policy publishes separately')

    const edited = (await api('/api/admin/content/policies/terms', { session: admin })).data
    edited.draft.sections[0].body = 'Changed in draft.'
    const after = await api('/api/admin/content/policies/terms', { session: admin, method: 'PUT', body: edited.draft })
    assert.equal(after.data.unpublishedChanges, true)
    assert.notEqual((await api('/api/content/policies/terms')).data.policy.sections[0].body, 'Changed in draft.')

    // Unsafe links and markup are refused.
    edited.draft.sections[0].body = 'See [this](javascript:alert(1)).'
    assert.equal((await api('/api/admin/content/policies/terms', { session: admin, method: 'PUT', body: edited.draft })).status, 400)

    await api('/api/admin/content/policies/terms/unpublish', { session: admin, method: 'POST', body: {} })
    assert.equal((await api('/api/content/policies/terms')).data.policy, null)
    assert.ok(await q(`select 1 from audit_log where action = 'content.policy_publish'`))
  })

  it('keeps text saved earlier in Settings as the first draft', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    await q(`insert into app_settings (key, value) values ('policies', $1)`, [JSON.stringify({ terms: 'My earlier terms.' })])
    const d = (await api('/api/admin/content/policies/terms', { session: admin })).data
    assert.deepEqual(d.draft.sections.map((s: any) => s.body), ['My earlier terms.'])
    assert.equal((await api('/api/admin/content/policies/privacy', { session: admin })).data.draft.sections.length > 5, true)
  })
})

describe('floating button settings', () => {
  beforeEach(setup)
  after(teardown)

  it('hints and glow default on, are saved by admins only, and reach the storefront', async () => {
    const admin = await signUp('owner@example.com', 'admin')
    const buyer = await signUp('buyer@example.com')
    assert.deepEqual((await api('/api/marketing')).data.launchers, { hints: true, glow: true })
    assert.equal((await api('/api/admin/settings/launchers', { session: buyer, method: 'PUT', body: { hints: false } })).status, 403)
    const r = await api('/api/admin/settings/launchers', { session: admin, method: 'PUT', body: { hints: false, extra: 'ignored' } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.deepEqual((await api('/api/marketing')).data.launchers, { hints: false, glow: true })
  })
})
