import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { timingSafeEqual } from 'node:crypto'
import { auth } from './auth.js'
import { db } from './db/pool.js'
import { config, deployEnv, integrationStatus, isProduction } from './env.js'
import { clientIp } from './http.js'
import { rateLimit } from './lib/rate-limit.js'
import { originGuard, sessionMiddleware, type AppEnv } from './http.js'
import { HttpError } from './lib/errors.js'
import { accountRoutes } from './routes/account.js'
import { adminRoutes } from './routes/admin.js'
import { publicRoutes } from './routes/public.js'
import { webhookRoutes } from './routes/webhooks.js'

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.mux.com'],
        mediaSrc: ["'self'", 'blob:', 'https://stream.mux.com'],
        connectSrc: ["'self'", 'https://*.mux.com', 'https://storage.googleapis.com'],
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
    try {
      await db().query('select 1')
      database = true
    } catch {
      database = false
    }
    const s = integrationStatus()
    return c.json(
      {
        status: database ? 'ok' : 'degraded',
        environment: deployEnv,
        database,
        payments: s.payments.state,
        email: s.email.configured ? 'configured' : 'not configured',
        storage: s.storage.driver,
        video: s.video.provider,
      },
      database ? 200 : 503,
      { 'cache-control': 'no-store' },
    )
  })

  // Staging gate: the whole staging site, dashboards included, needs the
  // staging username and password. Only payment, email and video webhooks
  // (which prove themselves with signatures) and the health check get through.
  if (deployEnv === 'staging') {
    const expected = Buffer.from(`${config.staging.accessUser}:${config.staging.accessPassword}`)
    app.use('*', async (c, next) => {
      c.header('x-robots-tag', 'noindex, nofollow')
      const path = c.req.path
      if (path.startsWith('/api/webhooks/') || path === '/api/health') return next()
      const header = c.req.header('authorization') ?? ''
      const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64') : Buffer.alloc(0)
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
      if (header) rateLimit(`staging-gate:${clientIp(c)}`, 20, 600)
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
  app.route('/api', publicRoutes)
  app.route('/api', accountRoutes)
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
