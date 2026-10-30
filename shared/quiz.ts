/*
  Resource quiz: content shape, validation and scoring, shared by the
  server (publishing checks), the storefront panel and the admin test mode,
  so all three always agree.

  Scoring, in plain words:
  * Every answer can add points to one or more result groups.
  * After the last question, the group with the most points wins.
  * A tie goes to the group with the lower priority number (1 beats 2).
  * If no group earned any points, the fallback result is shown.
  * Only published, active products are ever recommended. If the winning
    group has nothing available to show, the fallback is used instead.
*/

export type QuestionType = 'single' | 'multiple'

export interface QuizAnswer {
  id: string
  label: string
  /** resultId -> points (whole numbers 0 to 10). */
  points: Record<string, number>
}

export interface QuizQuestion {
  id: string
  text: string
  helper: string
  type: QuestionType
  required: boolean
  answers: QuizAnswer[]
}

export interface QuizResult {
  id: string
  title: string
  description: string
  productIds: string[]
  /** Category ids, for example nurse-inserts. */
  collections: string[]
  tutorialIds: string[]
  freebieCorner: boolean
  priority: number
}

export interface QuizContent {
  title: string
  intro: string
  ctaLabel: string
  questions: QuizQuestion[]
  results: QuizResult[]
  fallbackResultId: string
}

export const QUIZ_COLLECTIONS = ['nurse-inserts', 'np-inserts', 'apparel', 'accessories', 'pens', 'other'] as const

export const emptyQuiz = (): QuizContent => ({ title: '', intro: '', ctaLabel: '', questions: [], results: [], fallbackResultId: '' })

const ID = /^[a-z0-9_-]{1,40}$/i

/** Cleans untrusted input into the quiz shape. Throws a readable message on anything malformed. */
export function normalizeQuiz(input: unknown): QuizContent {
  const q = (input ?? {}) as Record<string, unknown>
  const text = (v: unknown, max: number) =>
    String(v ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, max)
  const id = (v: unknown, what: string) => {
    const s = String(v ?? '')
    if (!ID.test(s)) throw new Error(`Invalid ${what} id.`)
    return s
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const results: QuizResult[] = list(q.results).slice(0, 12).map((r: any) => ({
    id: id(r?.id, 'result'),
    title: text(r?.title, 80),
    description: text(r?.description, 400),
    productIds: [...new Set(list(r?.productIds).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 12),
    collections: [...new Set(list(r?.collections).map(String))].filter((c) => (QUIZ_COLLECTIONS as readonly string[]).includes(c)),
    tutorialIds: [...new Set(list(r?.tutorialIds).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 6),
    freebieCorner: Boolean(r?.freebieCorner),
    priority: Math.max(1, Math.min(99, Math.round(Number(r?.priority) || 1))),
  }))
  const resultIds = new Set(results.map((r) => r.id))
  if (resultIds.size !== results.length) throw new Error('Two result groups share an id.')
  const questions: QuizQuestion[] = list(q.questions).slice(0, 15).map((qq: any) => ({
    id: id(qq?.id, 'question'),
    text: text(qq?.text, 200),
    helper: text(qq?.helper, 240),
    type: qq?.type === 'multiple' ? 'multiple' : 'single',
    required: qq?.required !== false,
    answers: list(qq?.answers).slice(0, 10).map((a: any) => {
      const points: Record<string, number> = {}
      for (const [rid, n] of Object.entries((a?.points ?? {}) as Record<string, unknown>)) {
        const v = Math.round(Number(n))
        if (resultIds.has(rid) && v > 0) points[rid] = Math.min(10, v)
      }
      return { id: id(a?.id, 'answer'), label: text(a?.label, 120), points }
    }),
  }))
  return {
    title: text(q.title, 80),
    intro: text(q.intro, 400),
    ctaLabel: text(q.ctaLabel, 40),
    questions,
    results,
    fallbackResultId: resultIds.has(String(q.fallbackResultId)) ? String(q.fallbackResultId) : '',
  }
}

/** Everything that blocks publishing, in plain language. Empty means ready. */
export function publishProblems(c: QuizContent, opts: { availableProductIds?: Set<string> } = {}): string[] {
  const p: string[] = []
  if (!c.title) p.push('Add a quiz title.')
  if (!c.intro) p.push('Add an introduction.')
  if (!c.ctaLabel) p.push('Add the final button wording.')
  if (!c.questions.length) p.push('Add at least one question.')
  if (c.results.length < 1) p.push('Add at least one result group.')
  if (!c.fallbackResultId) p.push('Choose a fallback result.')
  c.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`
    if (!q.text) p.push(`${n} needs its question text.`)
    if (q.answers.length < 2) p.push(`${n} needs at least two answers.`)
    q.answers.forEach((a, j) => {
      if (!a.label) p.push(`${n}, answer ${j + 1} needs a label.`)
    })
    if (q.answers.length && q.answers.every((a) => !Object.keys(a.points).length)) p.push(`${n}: no answer adds points to any result, so it cannot affect the outcome.`)
  })
  c.results.forEach((r, i) => {
    const n = `Result ${i + 1}${r.title ? ` (${r.title})` : ''}`
    if (!r.title) p.push(`Result ${i + 1} needs a title.`)
    if (!r.description) p.push(`${n} needs a description.`)
    const usable = opts.availableProductIds ? r.productIds.filter((id) => opts.availableProductIds!.has(id)) : r.productIds
    if (!usable.length && !r.collections.length) p.push(`${n} needs at least one published product or a collection.`)
  })
  return p
}

/** Total points per result for the chosen answers. */
export function tally(c: QuizContent, answers: Record<string, string[]>) {
  const totals: Record<string, number> = Object.fromEntries(c.results.map((r) => [r.id, 0]))
  for (const q of c.questions) {
    for (const aid of answers[q.id] ?? []) {
      const a = q.answers.find((x) => x.id === aid)
      if (!a) continue
      for (const [rid, n] of Object.entries(a.points)) if (rid in totals) totals[rid] += n
    }
  }
  return totals
}

/**
 * The winning result. `hasContent` says whether a result has anything that
 * can be shown right now (active products or a collection); results without
 * content are skipped in favour of the fallback.
 */
export function pickResult(c: QuizContent, answers: Record<string, string[]>, hasContent: (r: QuizResult) => boolean = () => true) {
  const totals = tally(c, answers)
  const ranked = [...c.results].filter((r) => totals[r.id] > 0 && hasContent(r)).sort((a, b) => totals[b.id] - totals[a.id] || a.priority - b.priority || c.results.indexOf(a) - c.results.indexOf(b))
  const fallback = c.results.find((r) => r.id === c.fallbackResultId) ?? null
  const result = ranked[0] ?? (fallback && hasContent(fallback) ? fallback : null)
  return { result, totals, usedFallback: !ranked[0] }
}

/** The rules as a short explanation for the owner. */
export function explainRules(c: QuizContent) {
  const name = (id: string) => c.results.find((r) => r.id === id)?.title || 'Untitled result'
  const lines = [
    'Each answer adds points to the result groups you chose.',
    'After the last question, the group with the most points is shown.',
    'If two groups have the same points, the one with the lower priority number wins.',
    c.fallbackResultId ? `If no group gets any points, or the winner has nothing available to show, visitors see "${name(c.fallbackResultId)}".` : 'Choose a fallback result for when no group gets points.',
    'Only published, active products are ever shown.',
  ]
  return lines
}
