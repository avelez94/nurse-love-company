import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { QuizFlow } from '../../components/Launchers'
import { Checkbox, Confirm, dateTime, Empty, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { getCategory } from '../../data/catalog'
import { api, errorMessage } from '../../lib/api'
import type { PublicQuiz } from '../../lib/marketing'
import { href, navigate } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { emptyQuiz, explainRules, publishProblems, QUIZ_COLLECTIONS, type QuizContent, type QuizQuestion, type QuizResult } from '../../../shared/quiz'
import { PageTitle } from './AdminApp'

/*
  Marketing > Resource Quiz. The owner writes the questions, the result
  groups and how answers add points. Edits are saved to a draft; the
  storefront changes only when the owner presses Publish. Only one quiz is
  on the storefront at a time.
*/

interface QuizRow {
  id: string
  name: string
  status: 'draft' | 'published' | 'archived'
  version: number
  published_at: string | null
  updated_at: string
  unpublishedChanges: boolean
  questionCount: number
  stats: { starts: number; completions: number; productClicks: number }
}

const statusLabel = { draft: 'Draft', published: 'On the storefront', archived: 'Archived' }
const QuizStatus = ({ status }: { status: QuizRow['status'] }) => <Pill value={status} label={statusLabel[status]} />

function QuizStats({ s }: { s: QuizRow['stats'] }) {
  return (
    <dl className="mk-stats">
      <div><dt>Started</dt><dd>{s.starts}</dd></div>
      <div><dt>Finished</dt><dd>{s.completions}</dd></div>
      <div><dt>Finish rate</dt><dd>{s.starts ? `${Math.round((s.completions / s.starts) * 100)}%` : 'None yet'}</dd></div>
      <div><dt>Product clicks</dt><dd>{s.productClicks}</dd></div>
    </dl>
  )
}

export function Quizzes() {
  const { data, error, loading } = useApiData<{ quizzes: QuizRow[] }>('/api/admin/quizzes')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const rows = (data?.quizzes ?? []).filter((q) => showArchived || q.status !== 'archived')

  const create = async () => {
    setBusy(true)
    setCreateError('')
    try {
      const r = await api<{ id: string }>('/api/admin/quizzes', { body: { name } })
      navigate(`admin-quiz-${r.id}`)
    } catch (err) {
      setCreateError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle title="Resource Quiz">
        <button type="button" className="button button--small" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> New quiz
        </button>
      </PageTitle>
      <Notice>
        The quiz opens from the "Find my resources" button in the corner of the store, and from "Find your essentials" on the home page. It asks a few questions and suggests products. It is not a
        medical assessment, needs no email, and answers are never stored. Only one quiz is on the storefront at a time; the button is hidden until you publish one.
      </Notice>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No quizzes yet">
          <button type="button" className="button button--small" onClick={() => setCreating(true)}>Create the first quiz</button>
        </Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Quiz</th><th>Status</th><th className="num">Questions</th><th className="num">Started / finished</th><th className="num">Product clicks</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    <a href={href(`admin-quiz-${q.id}`)}>{q.name}</a>
                    {q.unpublishedChanges && <div className="muted">Has changes that are not published yet</div>}
                  </td>
                  <td><QuizStatus status={q.status} /></td>
                  <td className="num">{q.questionCount}</td>
                  <td className="num">{q.stats.starts} / {q.stats.completions}</td>
                  <td className="num">{q.stats.productClicks}</td>
                  <td className="muted">{dateTime(q.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Checkbox label="Show archived quizzes" checked={showArchived} onChange={setShowArchived} />
      <Confirm open={creating} title="New quiz" confirmLabel="Create draft" onConfirm={create} onClose={() => setCreating(false)} busy={busy} disabled={!name.trim()}>
        <div className="form-stack">
          <TextInput label="Internal name" value={name} onChange={setName} maxLength={80} hint="Only you see this, for example “Spring 2027 quiz”." />
          <FormError message={createError} />
        </div>
      </Confirm>
    </>
  )
}

/* ---------- Editor ---------- */

interface QuizDetail {
  id: string
  name: string
  status: QuizRow['status']
  draft: QuizContent
  published: QuizContent | null
  version: number
  published_at: string | null
  updated_at: string
  unpublishedChanges: boolean
  problems: string[]
}
interface AdminProduct { id: string; slug: string; title: string; type: string; status: string; active: boolean; archived_at: string | null; price_cents: number | null; sale_price_cents: number | null; image_id: string | null }
interface AdminTutorial { id: string; slug: string; title: string; status: string }

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`
const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function OrderButtons({ index, count, onMove, onRemove, what }: { index: number; count: number; onMove: (by: number) => void; onRemove: () => void; what: string }) {
  return (
    <div className="quiz-ed__order">
      <button type="button" className="icon-button" aria-label={`Move ${what} up`} disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={`Move ${what} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDown size={16} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={`Remove ${what}`} onClick={onRemove}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function QuizEditor({ id }: { id: string }) {
  const detail = useApiData<QuizDetail>(`/api/admin/quizzes/${id}`)
  const productsData = useApiData<{ products: AdminProduct[] }>('/api/admin/products')
  const tutorialsData = useApiData<{ tutorials: AdminTutorial[] }>('/api/admin/tutorials')
  const { showToast } = useUI()
  const [name, setName] = useState('')
  const [c, setC] = useState<QuizContent>(emptyQuiz())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testKey, setTestKey] = useState(0)
  const stats = useQuizStats(id, quizVersion(detail.data))
  const d = detail.data

  useEffect(() => {
    if (d) {
      setName(d.name)
      setC(d.draft)
      setDirty(false)
    }
  }, [d])

  const products = productsData.data?.products ?? []
  const liveProducts = useMemo(() => products.filter((p) => p.status === 'published' && p.active && !p.archived_at), [products])
  const liveIds = useMemo(() => new Set(liveProducts.map((p) => p.id)), [liveProducts])
  const tutorials = (tutorialsData.data?.tutorials ?? []).filter((t) => t.status === 'published')
  const problems = useMemo(() => publishProblems(c, { availableProductIds: liveIds }), [c, liveIds])

  if (detail.error) return <FormError message={detail.error} />
  if (!d) return <Loading />
  const archived = d.status === 'archived'

  const update = (fn: (c: QuizContent) => QuizContent) => {
    setC((prev) => fn(prev))
    setDirty(true)
  }
  const setResult = (i: number, patch: Partial<QuizResult>) => update((x) => ({ ...x, results: x.results.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  const setQuestion = (i: number, patch: Partial<QuizQuestion>) => update((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }))
  const removeResult = (i: number) =>
    update((x) => {
      const gone = x.results[i].id
      return {
        ...x,
        results: x.results.filter((_, j) => j !== i),
        fallbackResultId: x.fallbackResultId === gone ? '' : x.fallbackResultId,
        questions: x.questions.map((q) => ({ ...q, answers: q.answers.map((a) => ({ ...a, points: Object.fromEntries(Object.entries(a.points).filter(([k]) => k !== gone)) })) })),
      }
    })

  const save = async (quiet = false) => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/quizzes/${id}`, { method: 'PUT', body: { name, draft: c } })
      if (!quiet) showToast(d.status === 'published' ? 'Draft saved. The storefront keeps the published version until you publish.' : 'Draft saved.')
      await detail.reload()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  const act = async (path: string, message: string) => {
    if (dirty && !archived && !(await save(true))) return
    setBusy(true)
    setError('')
    try {
      const r = await api<{ id?: string }>(`/api/admin/quizzes/${id}/${path}`, { body: {} })
      showToast(message)
      if (path === 'duplicate' && r.id) navigate(`admin-quiz-${r.id}`)
      else await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // The test uses the draft exactly as the storefront would show it.
  const testQuiz: PublicQuiz = {
    id: d.id,
    version: d.version,
    content: c,
    products: liveProducts.map((p) => ({ id: p.id, slug: p.slug, title: p.title, type: p.type, priceCents: p.price_cents, salePriceCents: p.sale_price_cents, imageUrl: p.image_id ? `/api/media/${p.image_id}` : null })),
    tutorials: tutorials.map((t) => ({ id: t.id, slug: t.slug, title: t.title })),
  }
  const resultOptions = [{ value: '', label: 'Choose a fallback result' }, ...c.results.map((r) => ({ value: r.id, label: r.title || 'Untitled result' }))]

  return (
    <>
      <PageTitle title={name || 'Quiz'} back={{ label: 'Resource Quiz', route: 'admin-quizzes' }}>
        <QuizStatus status={d.status} />
      </PageTitle>
      {d.status === 'published' && (dirty || d.unpublishedChanges) && (
        <Notice tone="warn">You have changes that are not on the storefront yet. Visitors see the published version until you press Publish changes.</Notice>
      )}
      {archived && <Notice>This quiz is archived. Restore it to edit or publish it.</Notice>}

      <fieldset className="quiz-ed" disabled={archived}>
        <section className="panel form-stack">
          <h2 className="panel__title">Basics</h2>
          <TextInput label="Internal name" value={name} onChange={(v) => { setName(v); setDirty(true) }} maxLength={80} hint="Only you see this." />
          <TextInput label="Quiz title" value={c.title} onChange={(v) => update((x) => ({ ...x, title: v }))} maxLength={80} hint="Shown at the top of the panel." />
          <TextArea label="Introduction" value={c.intro} onChange={(v) => update((x) => ({ ...x, intro: v }))} maxLength={400} rows={3} hint="A friendly sentence or two before the Start button." />
          <TextInput label="Final button wording" value={c.ctaLabel} onChange={(v) => update((x) => ({ ...x, ctaLabel: v }))} maxLength={40} hint="Shown with the results. It opens the shop." />
        </section>

        <section className="panel form-stack">
          <div className="panel__head">
            <h2 className="panel__title">Result groups</h2>
            <button
              type="button"
              className="button button--outline button--small"
              disabled={c.results.length >= 12}
              onClick={() => update((x) => ({ ...x, results: [...x.results, { id: newId('r'), title: '', description: '', productIds: [], collections: [], tutorialIds: [], freebieCorner: false, priority: x.results.length + 1 }] }))}
            >
              <Plus size={16} aria-hidden="true" /> Add result
            </button>
          </div>
          <p className="muted">Each group is a possible result. Answers add points to groups; the group with the most points is shown. Only published, active products can be shown.</p>
          {c.results.map((r, i) => (
            <div key={r.id} className="quiz-ed__card">
              <div className="quiz-ed__card-head">
                <strong>Result {i + 1}</strong>
                <OrderButtons index={i} count={c.results.length} what={`result ${i + 1}`} onMove={(by) => update((x) => ({ ...x, results: move(x.results, i, by) }))} onRemove={() => removeResult(i)} />
              </div>
              <div className="form-grid">
                <TextInput label="Result title" value={r.title} onChange={(v) => setResult(i, { title: v })} maxLength={80} />
                <TextInput label="Tie break priority" type="number" value={String(r.priority)} onChange={(v) => setResult(i, { priority: Math.max(1, Math.min(99, Number(v) || 1)) })} hint="1 wins over 2 when points are equal." />
              </div>
              <TextArea label="Short explanation" value={r.description} onChange={(v) => setResult(i, { description: v })} maxLength={400} rows={3} hint="Why these resources may help. Avoid medical or clinical advice." />
              <fieldset className="quiz-ed__choices">
                <legend className="field__label">Products</legend>
                {!products.length && <p className="muted">No products yet.</p>}
                {products
                  .filter((p) => !p.archived_at)
                  .map((p) => (
                    <Checkbox
                      key={p.id}
                      label={
                        <>
                          {p.title}
                          {!liveIds.has(p.id) && <span className="muted"> (not published, will not be shown)</span>}
                        </>
                      }
                      checked={r.productIds.includes(p.id)}
                      onChange={(on) => setResult(i, { productIds: on ? [...r.productIds, p.id] : r.productIds.filter((x) => x !== p.id) })}
                    />
                  ))}
              </fieldset>
              <fieldset className="quiz-ed__choices">
                <legend className="field__label">Collections</legend>
                {QUIZ_COLLECTIONS.filter((cid) => cid !== 'other').map((cid) => (
                  <Checkbox key={cid} label={getCategory(cid).title} checked={r.collections.includes(cid)} onChange={(on) => setResult(i, { collections: on ? [...r.collections, cid] : r.collections.filter((x) => x !== cid) })} />
                ))}
              </fieldset>
              <fieldset className="quiz-ed__choices">
                <legend className="field__label">Free extras (optional)</legend>
                <Checkbox label="Link to The Freebie Corner" checked={r.freebieCorner} onChange={(on) => setResult(i, { freebieCorner: on })} />
                {tutorials.map((t) => (
                  <Checkbox key={t.id} label={`Tutorial: ${t.title}`} checked={r.tutorialIds.includes(t.id)} onChange={(on) => setResult(i, { tutorialIds: on ? [...r.tutorialIds, t.id] : r.tutorialIds.filter((x) => x !== t.id) })} />
                ))}
              </fieldset>
            </div>
          ))}
          <Select label="Fallback result" value={c.fallbackResultId} onChange={(v) => update((x) => ({ ...x, fallbackResultId: v }))} options={resultOptions} hint="Shown when no group earns points, or the winner has nothing available to show." />
        </section>

        <section className="panel form-stack">
          <div className="panel__head">
            <h2 className="panel__title">Questions</h2>
            <button
              type="button"
              className="button button--outline button--small"
              disabled={c.questions.length >= 15}
              onClick={() => update((x) => ({ ...x, questions: [...x.questions, { id: newId('q'), text: '', helper: '', type: 'single', required: true, answers: [{ id: newId('a'), label: '', points: {} }, { id: newId('a'), label: '', points: {} }] }] }))}
            >
              <Plus size={16} aria-hidden="true" /> Add question
            </button>
          </div>
          {!c.results.length && <p className="muted">Add result groups first, so answers have something to add points to.</p>}
          {c.questions.map((q, i) => (
            <div key={q.id} className="quiz-ed__card">
              <div className="quiz-ed__card-head">
                <strong>Question {i + 1}</strong>
                <OrderButtons index={i} count={c.questions.length} what={`question ${i + 1}`} onMove={(by) => update((x) => ({ ...x, questions: move(x.questions, i, by) }))} onRemove={() => update((x) => ({ ...x, questions: x.questions.filter((_, j) => j !== i) }))} />
              </div>
              <TextInput label="Question" value={q.text} onChange={(v) => setQuestion(i, { text: v })} maxLength={200} />
              <TextInput label="Helper text (optional)" value={q.helper} onChange={(v) => setQuestion(i, { helper: v })} maxLength={240} />
              <div className="form-grid">
                <Select label="Answer type" value={q.type} onChange={(v) => setQuestion(i, { type: v })} options={[{ value: 'single', label: 'Choose one' }, { value: 'multiple', label: 'Choose any that apply' }]} />
                <Checkbox label="Required" checked={q.required} onChange={(v) => setQuestion(i, { required: v })} hint="Optional questions can be skipped." />
              </div>
              <div className="quiz-ed__answers">
                {q.answers.map((a, k) => (
                  <div key={a.id} className="quiz-ed__answer">
                    <div className="quiz-ed__card-head">
                      <TextInput label={`Answer ${k + 1}`} value={a.label} onChange={(v) => setQuestion(i, { answers: q.answers.map((x, m) => (m === k ? { ...x, label: v } : x)) })} maxLength={120} />
                      <OrderButtons
                        index={k}
                        count={q.answers.length}
                        what={`answer ${k + 1}`}
                        onMove={(by) => setQuestion(i, { answers: move(q.answers, k, by) })}
                        onRemove={() => setQuestion(i, { answers: q.answers.filter((_, m) => m !== k) })}
                      />
                    </div>
                    {c.results.length > 0 && (
                      <div className="quiz-ed__points" role="group" aria-label={`Points for answer ${k + 1}`}>
                        {c.results.map((r) => (
                          <label key={r.id} className="quiz-ed__point">
                            <span>{r.title || 'Untitled result'}</span>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={10}
                              value={a.points[r.id] ?? 0}
                              onChange={(e) => {
                                const n = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0)))
                                const points = { ...a.points, [r.id]: n }
                                if (!n) delete points[r.id]
                                setQuestion(i, { answers: q.answers.map((x, m) => (m === k ? { ...x, points } : x)) })
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" className="button button--outline button--small" disabled={q.answers.length >= 10} onClick={() => setQuestion(i, { answers: [...q.answers, { id: newId('a'), label: '', points: {} }] })}>
                  <Plus size={16} aria-hidden="true" /> Add answer
                </button>
              </div>
            </div>
          ))}
        </section>
      </fieldset>

      <section className="panel">
        <h2 className="panel__title">How the rules work</h2>
        <ul className="quiz-ed__rules">
          {explainRules(c).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Test your quiz</h2>
          <button type="button" className="button button--outline button--small" onClick={() => setTestKey((k) => k + 1)}>
            Start over
          </button>
        </div>
        <p className="muted">Try answers here before publishing. It uses your current edits (even unsaved ones), shows the points each result earned, and nothing is counted in the results.</p>
        <div className="quiz-ed__test">
          <div className="launcher-panel launcher-panel--static">
            <QuizFlow key={testKey} quiz={testQuiz} preview />
          </div>
        </div>
      </section>

      {problems.length > 0 && (
        <Notice tone="warn">
          Before it can be published:
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <section className="panel">
        <h2 className="panel__title">Results for the published version</h2>
        <QuizStats s={stats ?? { starts: 0, completions: 0, productClicks: 0 }} />
        <p className="muted">Totals only. Individual answers are never stored. Counts restart each time you publish changes.</p>
      </section>

      <FormError message={error} />
      <div className="sticky-actions">
        {!archived && <button type="button" className="button" disabled={busy} onClick={() => save()}>Save draft</button>}
        {!archived && (
          <button type="button" className="button button--outline" disabled={busy || problems.length > 0} onClick={() => act('publish', 'Published to the storefront.')}>
            {d.status === 'published' ? 'Publish changes' : 'Publish'}
          </button>
        )}
        {d.status === 'published' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish', 'Unpublished. The quiz button is hidden.')}>Unpublish</button>}
        <button type="button" className="button button--outline" disabled={busy} onClick={() => act('duplicate', 'Copy created.')}>
          <Copy size={16} aria-hidden="true" /> Duplicate
        </button>
        {d.status === 'draft' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('archive', 'Archived.')}>Archive</button>}
        {archived && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('restore', 'Restored as a draft.')}>Restore</button>}
        {dirty && <span className="muted">Unsaved changes</span>}
      </div>
    </>
  )
}

/** Stats for one quiz, from the list endpoint (aggregate counts only). */
const quizVersion = (d: QuizDetail | null) => d?.version ?? 0
function useQuizStats(id: string, version: number) {
  const { data } = useApiData<{ quizzes: QuizRow[] }>(`/api/admin/quizzes?v=${version}`)
  return data?.quizzes.find((q) => q.id === id)?.stats
}
