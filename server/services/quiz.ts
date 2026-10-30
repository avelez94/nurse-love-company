/*
  Resource quiz. One quiz can be published (the storefront quiz); others
  stay drafts or are archived. Edits always go to the draft copy; the
  storefront reads only the published copy, which changes only on Publish.
  Statistics are aggregate counts: answers are never stored.
*/
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { str } from '../lib/validate.js'
import { emptyQuiz, normalizeQuiz, publishProblems, type QuizContent } from '../../shared/quiz.js'
import { PUBLIC_WHERE } from './catalog.js'

interface QuizRow {
  id: string
  name: string
  status: 'draft' | 'published' | 'archived'
  draft: QuizContent
  published: QuizContent | null
  version: number
  published_at: string | null
  updated_at: string
  created_at: string
}

function parse(input: unknown) {
  try {
    return normalizeQuiz(input)
  } catch (err) {
    throw badRequest((err as Error).message)
  }
}

async function availableProductIds() {
  return new Set((await q<{ id: string }>(`select p.id from products p where ${PUBLIC_WHERE}`)).map((r) => r.id))
}

export async function listQuizzes() {
  const rows = await q<QuizRow>(`select * from quizzes order by (status = 'published') desc, (status = 'archived'), updated_at desc`)
  const stats = await q<{ quiz_id: string; version: number; starts: number; completions: number; product_clicks: number }>(
    `select quiz_id, version, sum(starts)::int as starts, sum(completions)::int as completions, sum(product_clicks)::int as product_clicks from quiz_stats group by quiz_id, version`,
  )
  return rows.map((r) => {
    const s = stats.find((x) => x.quiz_id === r.id && x.version === r.version) ?? { starts: 0, completions: 0, product_clicks: 0 }
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      version: r.version,
      published_at: r.published_at,
      updated_at: r.updated_at,
      unpublishedChanges: r.status === 'published' && JSON.stringify(r.draft) !== JSON.stringify(r.published),
      questionCount: r.draft.questions.length,
      stats: { starts: s.starts, completions: s.completions, productClicks: s.product_clicks },
    }
  })
}

export async function getQuiz(id: string) {
  const r = await one<QuizRow>('select * from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  const available = await availableProductIds()
  return {
    ...r,
    unpublishedChanges: r.status === 'published' && JSON.stringify(r.draft) !== JSON.stringify(r.published),
    problems: publishProblems(r.draft, { availableProductIds: available }),
  }
}

export async function createQuiz(actor: SessionUser, body: Record<string, unknown>, ip?: string) {
  const name = str(body.name, 'Internal name', { min: 1, max: 80 })
  const draft = body.draft ? parse(body.draft) : emptyQuiz()
  const row = await one<{ id: string }>(`insert into quizzes (name, draft, created_by) values ($1, $2, $3) returning id`, [name, JSON.stringify(draft), actor.email])
  await audit({ actor, action: 'quiz.created', entityType: 'quiz', entityId: row!.id, summary: `Created quiz draft "${name}"`, ip })
  return row!
}

/** Saves the draft copy only. A published quiz keeps showing its published copy until Publish. */
export async function saveQuizDraft(actor: SessionUser, id: string, body: Record<string, unknown>) {
  const r = await one<QuizRow>('select status from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  if (r.status === 'archived') throw badRequest('Restore this quiz before editing it.')
  const name = str(body.name, 'Internal name', { min: 1, max: 80 })
  const draft = parse(body.draft)
  await q(`update quizzes set name = $2, draft = $3, updated_at = now() where id = $1`, [id, name, JSON.stringify(draft)])
  return getQuiz(id)
}

export async function publishQuiz(actor: SessionUser, id: string, ip?: string) {
  const r = await one<QuizRow>('select * from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  if (r.status === 'archived') throw badRequest('Restore this quiz before publishing it.')
  const problems = publishProblems(r.draft, { availableProductIds: await availableProductIds() })
  if (problems.length) throw badRequest(`This quiz is not ready to publish. ${problems.join(' ')}`)
  await tx(async (client) => {
    // Only one storefront quiz: any other published quiz goes back to draft.
    const others = await q<{ id: string; name: string }>(`update quizzes set status = 'draft', updated_at = now() where status = 'published' and id <> $1 returning id, name`, [id], client)
    await q(`update quizzes set status = 'published', published = draft, version = version + 1, published_at = now(), updated_at = now() where id = $1`, [id], client)
    await audit({ actor, action: 'quiz.published', entityType: 'quiz', entityId: id, summary: `Published quiz "${r.name}"${others.length ? `, replacing "${others.map((o) => o.name).join(', ')}" on the storefront` : ''}`, ip }, client)
  })
  return getQuiz(id)
}

export async function setQuizStatus(actor: SessionUser, id: string, action: 'unpublish' | 'archive' | 'restore', ip?: string) {
  const r = await one<QuizRow>('select * from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  if (action === 'archive' && r.status === 'published') throw badRequest('Unpublish the quiz before archiving it.')
  const status = action === 'archive' ? 'archived' : 'draft'
  await q(`update quizzes set status = $2, updated_at = now() where id = $1`, [id, status])
  await audit({ actor, action: `quiz.${action}`, entityType: 'quiz', entityId: id, summary: `${action === 'unpublish' ? 'Unpublished' : action === 'archive' ? 'Archived' : 'Restored'} quiz "${r.name}"`, ip })
  return getQuiz(id)
}

export async function duplicateQuiz(actor: SessionUser, id: string, ip?: string) {
  const r = await one<QuizRow>('select * from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  return createQuiz(actor, { name: `Copy of ${r.name}`.slice(0, 80), draft: r.draft }, ip)
}

/** The storefront quiz: published copy only, with only products that are public right now. */
export async function publicQuiz() {
  const r = await one<QuizRow>(`select * from quizzes where status = 'published'`)
  if (!r?.published) return null
  const c = r.published
  const productIds = [...new Set(c.results.flatMap((x) => x.productIds))]
  const tutorialIds = [...new Set(c.results.flatMap((x) => x.tutorialIds))]
  const products = productIds.length
    ? await q<{ id: string; slug: string; title: string; type: string; price_cents: number | null; sale_price_cents: number | null; image_id: string | null }>(
        `select p.id, p.slug, p.title, p.type, p.price_cents, p.sale_price_cents,
                (select i.id from product_images i where i.product_id = p.id and i.kind = 'gallery' and i.approved order by sort_order limit 1) as image_id
           from products p where p.id = any($1) and ${PUBLIC_WHERE}`,
        [productIds],
      )
    : []
  const tutorials = tutorialIds.length ? await q<{ id: string; slug: string; title: string }>(`select id, slug, title from tutorials where id = any($1) and status = 'published'`, [tutorialIds]) : []
  return {
    id: r.id,
    version: r.version,
    content: c,
    products: products.map((p) => ({ id: p.id, slug: p.slug, title: p.title, type: p.type, priceCents: p.price_cents, salePriceCents: p.sale_price_cents, imageUrl: p.image_id ? `/api/media/${p.image_id}` : null })),
    tutorials,
  }
}

/** Aggregate counts for the current published version only. */
export async function recordQuizEvent(id: string, version: number, event: 'start' | 'complete' | 'product_click') {
  const r = await one<{ version: number }>(`select version from quizzes where id = $1 and status = 'published'`, [id])
  if (!r || r.version !== version) return false
  const col = event === 'start' ? 'starts' : event === 'complete' ? 'completions' : 'product_clicks'
  await q(
    `insert into quiz_stats (quiz_id, version, day, ${col}) values ($1,$2,current_date,1)
     on conflict (quiz_id, version, day) do update set ${col} = quiz_stats.${col} + 1`,
    [id, version],
  )
  return true
}
