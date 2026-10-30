import { createAuth, setAuth } from './auth.js'
import { resolveDatabaseUrl } from './db/dev-db.js'
import { migrate } from './db/migrate.js'
import { initPool } from './db/pool.js'
import { config } from './env.js'

/**
 * Connects to the database and initialises auth. A long running server
 * (local development, tests) also applies migrations here. Vercel functions
 * never do: migrations run once, deliberately, with `npm run migrate`.
 */
export async function boot(databaseUrl = config.databaseUrl, opts: { migrate?: boolean; auth?: boolean } = {}) {
  const url = await resolveDatabaseUrl(databaseUrl)
  const pool = initPool(url)
  if (opts.migrate ?? true) await migrate(pool)
  if (opts.auth ?? true) setAuth(createAuth(pool))
  return pool
}
