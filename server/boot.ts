import { createAuth, setAuth } from './auth.js'
import { resolveDatabaseUrl } from './db/dev-db.js'
import { migrate } from './db/migrate.js'
import { initPool } from './db/pool.js'
import { config } from './env.js'

/** Connects to the database, applies migrations and initialises auth. */
export async function boot(databaseUrl = config.databaseUrl) {
  const url = await resolveDatabaseUrl(databaseUrl)
  const pool = initPool(url)
  await migrate(pool)
  setAuth(createAuth(pool))
  return pool
}
