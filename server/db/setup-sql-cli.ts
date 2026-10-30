// npm run db:sql: regenerates supabase/setup.sql (see setup-sql.ts).
import { mkdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { buildSetupSql, resetScratchDatabase, SQLCHECK_DATABASE_URL } from './setup-sql.js'

const pool = new pg.Pool({ connectionString: SQLCHECK_DATABASE_URL })
try {
  await resetScratchDatabase(pool)
  mkdirSync('supabase', { recursive: true })
  writeFileSync('supabase/setup.sql', await buildSetupSql(pool))
  console.log('Wrote supabase/setup.sql')
} finally {
  await pool.end()
}
