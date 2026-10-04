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
