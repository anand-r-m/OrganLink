import { pathToFileURL } from 'node:url'
import express from 'express'
import session from 'express-session'
import { pool } from './db.js'
import { errorHandler } from './errors.js'
import { requireAuth } from './middleware/requireAuth.js'
import authRouter from './routes/auth.js'
import bloodCompatibilityRouter from './routes/bloodCompatibility.js'
import dashboardRouter from './routes/dashboard.js'
import donorsRouter from './routes/donors.js'
import hlaAllelesRouter from './routes/hlaAlleles.js'
import hospitalsRouter from './routes/hospitals.js'
import lookupsRouter from './routes/lookups.js'
import matchingRouter from './routes/matching.js'
import offersRouter from './routes/offers.js'
import organTypesRouter from './routes/organTypes.js'
import organsRouter from './routes/organs.js'
import recipientsRouter from './routes/recipients.js'
import reportsRouter from './routes/reports.js'
import regionsRouter from './routes/regions.js'
import transplantsRouter from './routes/transplants.js'
import waitlistRouter from './routes/waitlist.js'
import transportRouter from './routes/transport.js'

const PORT = Number(process.env.PORT) || 3001

export const app = express()
app.use(express.json())

if (!process.env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET not set; using an insecure development default')
}
// In-memory store (05_tdd.md §1): sessions are lost on restart.
app.use(
  session({
    name: 'connect.sid',
    secret: process.env.SESSION_SECRET || 'organlink-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false },
  }),
)

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

// Every /api route mounted below this line needs a session (health and auth are above it).
app.use('/api/auth', authRouter) // applies requireAuth itself, except for /login
app.use('/api', requireAuth)
app.use('/api/blood-compatibility', bloodCompatibilityRouter)
app.use('/api/hla-alleles', hlaAllelesRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/donors', donorsRouter)
app.use('/api/hospitals', hospitalsRouter)
app.use('/api/lookups', lookupsRouter)
app.use('/api/organs', organsRouter)
app.use('/api/organ-types', organTypesRouter)
app.use('/api/regions', regionsRouter)
app.use('/api/matching', matchingRouter)
app.use('/api/offers', offersRouter)
app.use('/api/recipients', recipientsRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/transport', transportRouter)
app.use('/api/transplants', transplantsRouter)
app.use('/api/waitlist', waitlistRouter)

// Must stay after all routes.
app.use(errorHandler)

// Listen only when run directly, so tests can import `app` without binding a port.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`)
  })
}
