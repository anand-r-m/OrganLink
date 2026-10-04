import { pathToFileURL } from 'node:url'
import express from 'express'
import { pool } from './db.js'
import { errorHandler } from './errors.js'

const PORT = Number(process.env.PORT) || 3001

export const app = express()
app.use(express.json())

// GET /api/health: no auth, no sweep (API_CONTRACT endpoint #4).
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'ok' })
  } catch (err) {
    console.error('[health] db check failed:', err.message)
    res.status(503).json({
      error: { code: 'DB_UNAVAILABLE', message: 'Database unreachable', details: {} },
    })
  }
})

// Must stay after all routes.
app.use(errorHandler)

// Listen only when run directly, so tests can import `app` without binding a port.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`)
  })
}
