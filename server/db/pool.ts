import pg from 'pg'

// Return bigint counts and numeric values as numbers where safe.
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))

let pool: pg.Pool | null = null

export function initPool(connectionString: string) {
  pool = new pg.Pool({ connectionString, max: 10 })
  return pool
}

export function db(): pg.Pool {
  if (!pool) throw new Error('Database pool not initialised')
  return pool
}

export type Queryable = pg.Pool | pg.PoolClient

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = [], client: Queryable = db()): Promise<T[]> {
  const res = await client.query(text, params)
  return res.rows as T[]
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = [], client: Queryable = db()): Promise<T | null> {
  const rows = await q<T>(text, params, client)
  return rows[0] ?? null
}

/** Runs fn inside a transaction. Rolls back on any thrown error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
