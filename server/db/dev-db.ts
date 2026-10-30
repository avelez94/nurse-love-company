/*
  Local development database. When DATABASE_URL is not set (and we are not in
  production), an embedded PostgreSQL server is started in .data/postgres so the
  whole store runs with one command. Production always uses DATABASE_URL.
*/
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export async function resolveDatabaseUrl(databaseUrl: string): Promise<string> {
  if (databaseUrl) return databaseUrl
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production')
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const dir = join(process.cwd(), '.data', 'postgres')
  const port = Number(process.env.DEV_DB_PORT ?? 54329)
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'nurselove', password: 'nurselove-local', port, persistent: true })
  if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise()
  await pg.start()
  try {
    await pg.createDatabase('nurselove')
  } catch {
    /* already exists */
  }
  const stop = () => pg.stop().catch(() => {})
  process.once('SIGINT', () => stop().then(() => process.exit(0)))
  process.once('SIGTERM', () => stop().then(() => process.exit(0)))
  return `postgres://nurselove:nurselove-local@localhost:${port}/nurselove`
}
