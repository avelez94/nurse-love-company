import { Hono } from 'hono'
import { config } from '../env.js'
import { adminOnly, clientIp, jsonBody, requireAdmin, requireUser, type AppEnv } from '../http.js'
import { rateLimit } from '../lib/rate-limit.js'
import { serveMedia } from '../lib/stream.js'
import { receiveUpload } from '../lib/upload.js'
import { int, oneOf, uuid } from '../lib/validate.js'
import { adminHelp, adminStory, publicHelp, publicStory, publishHelp, saveHelpDraft, publishStory, saveStoryDraft, STORY_UPLOAD_TARGET, storyPortrait } from '../services/content.js'
import { createQuiz, duplicateQuiz, getQuiz, listQuizzes, publicQuiz, publishQuiz, recordQuizEvent, saveQuizDraft, setQuizStatus } from '../services/quiz.js'
import { adminReviews, moderateReview, myReview, productReviews, REPORT_REASONS, reportReview, reviewablePurchases, saveReview } from '../services/reviews.js'
import { attachUpload } from '../services/uploads.js'
import { one } from '../db/pool.js'

export const featureRoutes = new Hono<AppEnv>()
const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c)

/* ---------- Public ---------- */

featureRoutes.get('/quiz', async (c) => c.json({ quiz: await publicQuiz() }, 200, { 'cache-control': 'public, max-age=60' }))
/** Aggregate counts only: no answers are sent or stored. */
featureRoutes.post('/quiz/events', async (c) => {
  await rateLimit(`quiz-events:${clientIp(c)}`, 120, 600)
  const b = await jsonBody(c)
  const counted = await recordQuizEvent(uuid(b.quiz_id), int(b.version, 'Version', { min: 1, max: 100_000 })!, oneOf(b.event, 'Event', ['start', 'complete', 'product_click'] as const))
  return c.json({ counted })
})

featureRoutes.get('/products/:slug/reviews', async (c) => {
  const p = await one<{ id: string }>(`select id from products where slug = $1 and status = 'published' and active and archived_at is null`, [c.req.param('slug')])
  if (!p) return c.json({ count: 0, average: null, reviews: [] })
  return c.json(await productReviews(p.id))
})
featureRoutes.post('/reviews/:id/report', async (c) => {
  await rateLimit(`review-report:${clientIp(c)}`, 10, 3600)
  await reportReview(uuid(c.req.param('id')), oneOf((await jsonBody(c)).reason, 'Reason', REPORT_REASONS))
  return c.json({ ok: true })
})

featureRoutes.get('/content/help', async (c) => c.json({ help: await publicHelp() }, 200, { 'cache-control': 'public, max-age=60' }))
featureRoutes.get('/content/our-story', async (c) => c.json({ story: await publicStory() }, 200, { 'cache-control': 'public, max-age=60' }))
featureRoutes.get('/content/our-story/portrait', async (c) => {
  const m = await storyPortrait('published')
  return serveMedia(c, m.key, m.type, 'public, max-age=300')
})

/* ---------- Customer ---------- */

featureRoutes.get('/account/reviews', async (c) => c.json({ purchases: await reviewablePurchases(requireUser(c)) }))
featureRoutes.get('/account/reviews/:productId', async (c) => c.json(await myReview(requireUser(c), uuid(c.req.param('productId')))))
featureRoutes.put('/account/reviews/:productId', async (c) => {
  const user = requireUser(c)
  await rateLimit(`review-write:${user.id}`, 10, 3600)
  return c.json(await saveReview(user, uuid(c.req.param('productId')), await jsonBody(c)))
})

/* ---------- Admin ---------- */

featureRoutes.use('/admin/*', adminOnly)

featureRoutes.get('/admin/quizzes', async (c) => c.json({ quizzes: await listQuizzes() }))
featureRoutes.post('/admin/quizzes', async (c) => c.json(await createQuiz(requireAdmin(c), await jsonBody(c), ip(c)), 201))
featureRoutes.get('/admin/quizzes/:id', async (c) => c.json(await getQuiz(uuid(c.req.param('id')))))
featureRoutes.put('/admin/quizzes/:id', async (c) => c.json(await saveQuizDraft(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c))))
featureRoutes.post('/admin/quizzes/:id/publish', async (c) => c.json(await publishQuiz(requireAdmin(c), uuid(c.req.param('id')), ip(c))))
featureRoutes.post('/admin/quizzes/:id/duplicate', async (c) => c.json(await duplicateQuiz(requireAdmin(c), uuid(c.req.param('id')), ip(c)), 201))
featureRoutes.post('/admin/quizzes/:id/:action', async (c) => {
  const action = oneOf(c.req.param('action'), 'Action', ['unpublish', 'archive', 'restore'] as const)
  return c.json(await setQuizStatus(requireAdmin(c), uuid(c.req.param('id')), action, ip(c)))
})

featureRoutes.get('/admin/reviews', async (c) =>
  c.json(
    await adminReviews({
      status: c.req.query('status') ? oneOf(c.req.query('status'), 'Status', ['pending', 'published', 'rejected', 'reported'] as const) : undefined,
      productId: c.req.query('product') ? uuid(c.req.query('product')) : undefined,
      rating: c.req.query('rating') ? (int(c.req.query('rating'), 'Rating', { min: 1, max: 5 }) ?? undefined) : undefined,
    }),
  ),
)
featureRoutes.post('/admin/reviews/:id', async (c) => {
  await moderateReview(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), ip(c))
  return c.json({ ok: true })
})

featureRoutes.get('/admin/content/help', async (c) => c.json(await adminHelp()))
featureRoutes.put('/admin/content/help', async (c) => c.json(await saveHelpDraft(requireAdmin(c), await jsonBody(c))))
featureRoutes.post('/admin/content/help/:action', async (c) => c.json(await publishHelp(requireAdmin(c), oneOf(c.req.param('action'), 'Action', ['publish', 'unpublish'] as const), ip(c))))
featureRoutes.get('/admin/content/our-story', async (c) => c.json(await adminStory()))
featureRoutes.put('/admin/content/our-story', async (c) => c.json(await saveStoryDraft(requireAdmin(c), await jsonBody(c))))
featureRoutes.get('/admin/content/our-story/portrait', async (c) => {
  const m = await storyPortrait('draft')
  return serveMedia(c, m.key, m.type, 'private, no-store')
})
featureRoutes.post('/admin/content/our-story/portrait', async (c) => {
  const actor = requireAdmin(c)
  const f = await receiveUpload(c, 'image', 'content/our-story', config.limits.imageBytes)
  return c.json(await attachUpload(actor, 'story_portrait', STORY_UPLOAD_TARGET, f, {}, ip(c)), 201)
})
featureRoutes.post('/admin/content/our-story/:action', async (c) => c.json(await publishStory(requireAdmin(c), oneOf(c.req.param('action'), 'Action', ['publish', 'unpublish'] as const), ip(c))))
