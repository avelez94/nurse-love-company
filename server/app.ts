import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { timingSafeEqual } from 'node:crypto'
import { auth } from './auth.js'
import { db } from './db/pool.js'
import { LATEST_MIGRATION } from './db/schema-version.js'
import { drainOutbox, requeueStalled } from './email/outbox.js'
import { config, deployEnv, integrationStatus, isProduction } from './env.js'
import { pruneRateLimits } from './lib/rate-limit.js'
import { recheckCoupons } from './services/marketing.js'
import { cleanAbandonedUploads } from './services/uploads.js'
import { clientIp } from './http.js'
import { rateLimit } from './lib/rate-limit.js'
import { originGuard, sessionMiddleware, type AppEnv } from './http.js'
import { HttpError } from './lib/errors.js'
import { accountRoutes } from './routes/account.js'
import { adminRoutes } from './routes/admin.js'
import { marketingRoutes } from './routes/marketing.js'
import { featureRoutes } from './routes/features.js'
import { publicRoutes } from './routes/public.js'
import { webhookRoutes } from './routes/webhooks.js'
import { automationRoutes } from './routes/automations.js'
import { printfulRoutes } from './routes/printful.js'
import { runPrintfulMaintenance } from './services/printful.js'
import { runAutomations } from './services/automations.js'
import { runUpdateNotifications } from './services/updates.js'
import { syncMarketingContacts } from './services/consent.js'

export function createApp() {
  const app = new Hono<AppEnv>()
  // Signed media links and direct uploads go to Supabase Storage.
  const storageOrigin = config.storage.driver === 'supabase' && config.storage.supabase.url ? [new URL(config.storage.supabase.url).origin] : []

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.mux.com', ...storageOrigin],
        mediaSrc: ["'self'", 'blob:', 'https://stream.mux.com', ...storageOrigin],
        connectSrc: ["'self'", 'https://*.mux.com', 'https://storage.googleapis.com', ...storageOrigin],
        frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://checkout.stripe.com'],
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
      crossOriginEmbedderPolicy: false,
    }),
  )

  // Health check for the host. No secrets: only whether each part is reachable.
  // Deliberately outside the staging gate so the host can check it.
  app.get('/api/health', async (c) => {
    let database = false
    let schema: 'current' | 'behind' | 'unknown' = 'unknown'
    try {
      await db().query('select 1')
      database = true
      const row = await db().query<{ latest: string | null }>('select max(name) as latest from schema_migrations')
      schema = row.rows[0]?.latest === LATEST_MIGRATION ? 'current' : 'behind'
    } catch {
      // A missing schema_migrations table also means the migrations have not been run.
      schema = database ? 'behind' : 'unknown'
    }
    // (A misconfigured Vercel deployment never reaches this: see serverless.ts.)
    const s = integrationStatus()
    const ok = database && schema === 'current'
    return c.json(
      {
        status: ok ? 'ok' : 'degraded',
        environment: deployEnv,
        database,
        schema,
        payments: s.payments.state,
        email: s.email.configured ? 'configured' : 'not configured',
        storage: s.storage.driver,
        video: s.video.provider,
        scheduledJobs: s.scheduledJobs ? 'configured' : 'not configured',
      },
      ok ? 200 : 503,
      { 'cache-control': 'no-store' },
    )
  })

  /*
    Scheduled maintenance (Vercel Cron, or any scheduler that sends the
    secret). Retries emails left behind by a stopped instance and tidies
    expired records. Safe to run any number of times, even concurrently.
  */
  app.get('/api/cron/maintenance', async (c) => {
    const given = Buffer.from(c.req.header('authorization') ?? '')
    const want = Buffer.from(`Bearer ${config.cronSecret}`)
    if (!config.cronSecret || given.length !== want.length || !timingSafeEqual(given, want)) return c.json({ error: 'Not authorized.' }, 401)
    await requeueStalled()
    const automations = await runAutomations()
    const updateNotifications = await runUpdateNotifications()
    const emailList = await syncMarketingContacts()
    // Printful: due submissions, availability, and orders still in progress (in case a webhook was missed).
    const printfulWork = await runPrintfulMaintenance().catch((err) => ({ error: String((err as Error).message) }))
    await drainOutbox(100)
    await pruneRateLimits()
    const uploadsCleaned = await cleanAbandonedUploads()
    const couponBannersStopped = await recheckCoupons()
    return c.json({ ok: true, uploadsCleaned, couponBannersStopped, automations, updateNotifications, emailList, printful: printfulWork }, 200, { 'cache-control': 'no-store' })
  })

  // Staging gate: the whole staging site, dashboards included, needs the
  // staging username and password. Only payment, email and video webhooks
  // (which prove themselves with signatures), the health check and the
  // scheduled job (which needs its own secret) get through.
  if (deployEnv === 'staging') {
    const expected = Buffer.from(`${config.staging.accessUser}:${config.staging.accessPassword}`)
    app.use('*', async (c, next) => {
      c.header('x-robots-tag', 'noindex, nofollow')
      const path = c.req.path
      if (path.startsWith('/api/webhooks/') || path === '/api/health' || path === '/api/cron/maintenance') return next()
      const header = c.req.header('authorization') ?? ''
      const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64') : Buffer.alloc(0)
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
      if (header) await rateLimit(`staging-gate:${clientIp(c)}`, 20, 600)
      return c.text('This is a private staging preview. Please sign in with the staging username and password.', 401, {
        'www-authenticate': 'Basic realm="Nurse Love Company staging", charset="UTF-8"',
        'cache-control': 'no-store',
      })
    })
  }

  // JSON bodies are capped at 1 MB. File uploads stream with their own limits.
  app.use('/api/*', async (c, next) => {
    const type = c.req.header('content-type') ?? ''
    if (type.includes('application/json') && Number(c.req.header('content-length') ?? 0) > 1024 * 1024) {
      return c.json({ error: 'Request is too large.', code: 'too_large' }, 413)
    }
    await next()
  })

  app.use('/api/*', originGuard)
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth().handler(c.req.raw))
  app.use('/api/*', sessionMiddleware)
  app.use('/api/*', async (c, next) => {
    await next()
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store')
  })

  app.route('/api', webhookRoutes)
  app.route('/api', automationRoutes)
  app.route('/api', printfulRoutes)
  app.route('/api', publicRoutes)
  app.route('/api', accountRoutes)
  app.route('/api', marketingRoutes)
  app.route('/api', featureRoutes)
  app.route('/api', adminRoutes)

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.', code: 'not_found' }, 404) : c.text('Not found', 404)))

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code, details: err.details }, err.status as 400)
    const pgCode = (err as { code?: string }).code
    if (pgCode === '23505') return c.json({ error: 'That conflicts with an existing record.', code: 'conflict' }, 409)
    if (pgCode === '22P02') return c.json({ error: 'Invalid identifier.', code: 'bad_request' }, 400)
    console.error('[api] unexpected error', err)
    return c.json({ error: 'Something went wrong on our side. Please try again.', code: 'server_error' }, 500)
  })

  return app
}
