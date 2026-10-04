import 'dotenv/config'
import pg from 'pg'
import { toCamelRows } from './util/case.js'

// A12: INT8 (20) and NUMERIC (1700) arrive as JS numbers, not strings.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// Idle-client errors would otherwise crash the process (e.g. Postgres restarted).
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message)
})

// Convenience: run a query and return camelCased rows.
export async function query(text, params) {
  const result = await pool.query(text, params)
  return toCamelRows(result.rows)
}

// Run fn(client) inside one transaction attributed to userId (05_tdd.md §6, A1).
// sweep: run expire_stale_offers() first, in its own committed statement.
export async function withTx(userId, fn, { sweep = false } = {}) {
  if (sweep) await pool.query('SELECT expire_stale_offers()')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // set_config(..., true) is transaction-local like SET LOCAL, but accepts a bind parameter.
    await client.query("SELECT set_config('app.user_id', $1::text, true)", [userId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr.message)
    }
    throw err
  } finally {
    client.release()
  }
}
