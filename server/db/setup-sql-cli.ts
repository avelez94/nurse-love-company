// npm run db:sql: regenerates supabase/setup.sql (see setup-sql.ts).
import { mkdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { buildSetupSql, buildUpdateSql, migrationFiles, resetScratchDatabase, SQLCHECK_DATABASE_URL, UPDATE_BASELINE } from './setup-sql.js'

const pool = new pg.Pool({ connectionString: SQLCHECK_DATABASE_URL })
try {
  await resetScratchDatabase(pool)
  mkdirSync('supabase', { recursive: true })
  writeFileSync('supabase/setup.sql', await buildSetupSql(pool))
  console.log('Wrote supabase/setup.sql')
  mkdirSync('supabase/updates', { recursive: true })
  for (const f of migrationFiles().filter((f) => f > UPDATE_BASELINE)) {
    writeFileSync(`supabase/updates/${f}`, buildUpdateSql(f))
    console.log(`Wrote supabase/updates/${f}`)
  }
} finally {
  await pool.end()
}
