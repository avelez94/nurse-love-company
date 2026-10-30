import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMigrations } from 'better-auth/db/migration'
import type pg from 'pg'
import { authOptions } from '../auth.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Creates or updates the Better Auth tables, then applies store migrations in order. */
export async function migrate(pool: pg.Pool) {
  // One migrator at a time: during a deploy two server instances can start
  // together. A session level advisory lock makes the second one wait, then
  // find nothing left to do. Each file runs in its own transaction and is
  // recorded only on success, so a failed or interrupted run is safe to retry.
  const lock = await pool.connect()
  try {
    await lock.query('select pg_advisory_lock(727001)')
    await runAll(pool)
  } finally {
    await lock.query('select pg_advisory_unlock(727001)').catch(() => {})
    lock.release()
  }
}

async function runAll(pool: pg.Pool) {
  const { runMigrations } = await getMigrations(authOptions(pool) as never)
  await runMigrations()

  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const applied = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name as string))
  const files = readdirSync(join(here, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(here, 'migrations', file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into schema_migrations(name) values ($1)', [file])
      await client.query('commit')
      console.log(`[db] applied ${file}`)
    } catch (err) {
      await client.query('rollback')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
}
