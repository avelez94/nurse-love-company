import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { boot } from './boot.js'
import { kickDispatcher } from './email/outbox.js'
import { config, deployEnv, deploymentProblems, integrationStatus } from './env.js'
import { seedIfEmpty } from './seed.js'

const problems = deploymentProblems()
if (problems.length) {
  console.error(`[api] Refusing to start the ${deployEnv} server:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

const pool = await boot()
// Local development fills an empty database with demo data. Staging only does
// so when an admin presses "Load demo content" (with DEMO_CONTENT=true).
if (deployEnv === 'development' && process.env.SEED_DEMO !== 'false') await seedIfEmpty()

const app = createApp()

// In production this one server also serves the built storefront.
if (existsSync('dist/index.html')) {
  app.use('/assets/*', serveStatic({ root: './dist', onFound: (_p, c) => c.header('cache-control', 'public, max-age=31536000, immutable') }))
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] Nurse Love Company server on http://localhost:${info.port}`)
  console.log('[api] integrations', JSON.stringify(integrationStatus()))
})

// Send anything left in the outbox from a previous run, then keep checking.
kickDispatcher()
setInterval(kickDispatcher, 30_000).unref()

process.on('SIGTERM', () => pool.end().finally(() => process.exit(0)))
