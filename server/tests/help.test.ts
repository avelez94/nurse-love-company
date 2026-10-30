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
