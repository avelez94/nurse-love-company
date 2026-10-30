/*
  The API as Vercel Functions. The same Hono app as the long running server,
  minus the parts that need one: no migrations at start up (run them with
  `npm run migrate`), no static files (Vercel serves dist/), and no email
  timer (see email/outbox.ts and /api/cron/maintenance).
*/
import { Hono } from 'hono'
import { createApp } from './app.js'
import { createAuth, setAuth } from './auth.js'
import { initPool } from './db/pool.js'
import { config, deployEnv, deploymentProblems } from './env.js'

export function createServerlessApp() {
  const problems = deploymentProblems()
  if (problems.length) {
    // Details go to the Vercel function logs, not to visitors.
    console.error(`[api] This ${deployEnv} deployment is not configured:\n  - ${problems.join('\n  - ')}`)
    const app = new Hono()
    app.all('*', (c) =>
      c.json({ status: 'misconfigured', error: 'This deployment is not fully configured yet. The details are in the Vercel function logs.', code: 'misconfigured' }, 503, { 'cache-control': 'no-store' }),
    )
    return app
  }
  const pool = initPool(config.databaseUrl)
  setAuth(createAuth(pool))
  return createApp()
}

/**
 * vercel.json sends every /api/... request to the single function at /api,
 * passing the original path as __path. Restores the original URL so the
 * app's routes match exactly as they do on a normal server.
 */
export function restorePath(req: Request): Request {
  const url = new URL(req.url)
  const original = url.searchParams.get('__path')
  if (original === null) return req
  url.searchParams.delete('__path')
  url.pathname = `/api/${original.replace(/^\/+/, '')}`
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, { method: req.method, headers: req.headers, body: hasBody ? req.body : undefined, signal: req.signal, ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit)
}
