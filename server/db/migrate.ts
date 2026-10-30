import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMigrations } from 'better-auth/db/migration'
import type pg from 'pg'
import { authOptions } from '../auth.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Creates or updates the Better Auth tables, then applies store migrations in order. */
export async function migrate(pool: pg.Pool) {
  // One migrator at a time: a second run waits on the lock, then finds
  // nothing left to do. The lock belongs to an open transaction, so it also
  // works through a transaction pooler. Each file runs in its own transaction
  // and is recorded only on success, so a failed run is safe to retry.
  const lock = await pool.connect()
  try {
    await lock.query('begin')
    await lock.query('select pg_advisory_xact_lock(727001)')
    await runAll(pool)
    await protectTables(pool)
  } finally {
    await lock.query('commit').catch(() => {})
    lock.release()
  }
}

/**
 * Supabase publishes every table in the public schema through its Data API.
 * This store never uses that API, so row level security is switched on with
 * no policies: the API sees nothing, while the server (the table owner) is
 * unaffected. Repeated on every run so new tables are covered too.
 */
async function protectTables(pool: pg.Pool) {
  await pool.query(`do $$ declare t record; begin
    for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
      execute format('alter table public.%I enable row level security', t.tablename);
    end loop; end $$`)
}

/** Name of the newest migration file, used to tell whether a database is up to date. */
export function latestMigration() {
  return readdirSync(join(here, 'migrations')).filter((f) => f.endsWith('.sql')).sort().pop() ?? ''
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
