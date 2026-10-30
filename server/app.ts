import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { auth } from './auth.js'
import { isProduction } from './env.js'
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
