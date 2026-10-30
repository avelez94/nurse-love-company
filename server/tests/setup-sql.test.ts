import './env.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import { getMigrations } from 'better-auth/db/migration'
import pg from 'pg'
import { authOptions } from '../auth.js'
import { latestMigration, migrate } from '../db/migrate.js'
import { buildSetupSql, buildUpdateSql, migrationFiles, resetScratchDatabase, SQLCHECK_DATABASE_URL, UPDATE_BASELINE } from '../db/setup-sql.js'

/*
  supabase/setup.sql is what gets pasted into Supabase's SQL Editor. It must
  produce exactly the database `npm run migrate` would, and be current.
*/
const pool = new pg.Pool({ connectionString: SQLCHECK_DATABASE_URL })
after(() => pool.end())

describe('Supabase setup script', () => {
  it('is up to date with the migrations', async () => {
    await resetScratchDatabase(pool)
    assert.equal(readFileSync('supabase/setup.sql', 'utf8'), await buildSetupSql(pool), 'supabase/setup.sql is stale: run npm run db:sql')
  })

  it('builds the same database as npm run migrate, and refuses to run twice', async () => {
    await resetScratchDatabase(pool)
    const sql = readFileSync('supabase/setup.sql', 'utf8')
    await pool.query(sql)

    const applied = (await pool.query<{ name: string }>('select name from schema_migrations order by name')).rows.map((r) => r.name)
    assert.equal(applied.at(-1), latestMigration())
    // Nothing left for Better Auth or the store migrations to do.
    const auth = await getMigrations(authOptions(pool) as never)
    assert.deepEqual([auth.toBeCreated.length, auth.toBeAdded.length], [0, 0])
    await migrate(pool)
    assert.deepEqual((await pool.query('select name from schema_migrations order by name')).rows.map((r) => r.name), applied)
    assert.deepEqual((await pool.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)).rows, [])

    // A second run stops with a clear message and changes nothing.
    await pool.query(`insert into app_settings (key, value) values ('probe', '1')`)
    await assert.rejects(pool.query(sql), /already set up/)
    await pool.query('rollback').catch(() => {})
    assert.equal((await pool.query(`select count(*)::int as n from app_settings where key = 'probe'`)).rows[0].n, 1)
  })

  it('each update script is current and upgrades an existing database to the same result', async () => {
    const updates = migrationFiles().filter((f) => f > UPDATE_BASELINE)
    for (const f of updates) assert.equal(readFileSync(`supabase/updates/${f}`, 'utf8'), buildUpdateSql(f), `supabase/updates/${f} is stale: run npm run db:sql`)
    await resetScratchDatabase(pool)
    // A database set up with the original script, before these updates existed.
    await pool.query(await buildSetupSql(pool, UPDATE_BASELINE))
    // Out of order is refused.
    if (updates.length > 1) await assert.rejects(pool.query(readFileSync(`supabase/updates/${updates[1]}`, 'utf8')), /Run the earlier update/)
    await pool.query('rollback').catch(() => {})
    for (const f of updates) await pool.query(readFileSync(`supabase/updates/${f}`, 'utf8'))
    await assert.rejects(pool.query(readFileSync(`supabase/updates/${updates[0]}`, 'utf8')), /already applied/)
    await pool.query('rollback').catch(() => {})
    const applied = (await pool.query<{ name: string }>('select name from schema_migrations order by name')).rows.map((r) => r.name)
    assert.deepEqual(applied, migrationFiles())
    await migrate(pool)
    assert.deepEqual((await pool.query('select name from schema_migrations order by name')).rows.map((r) => r.name), applied)
    assert.deepEqual((await pool.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)).rows, [])
  })
})
