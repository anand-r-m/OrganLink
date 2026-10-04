import { Router } from 'express'
import { pool, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { loadMatchRun } from '../util/matchRunSql.js'

const router = Router()

const KEYS = ['hla', 'urgency', 'distance', 'wait']
const MAX_WEIGHT = 999.99 // match_run weight columns are NUMERIC(5,2)
const invalid = (field, message) => new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] })

const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null)

// Returns {hla, urgency, distance, wait}, each a number or null (null = use the regional default).
function parseWeights(weights) {
  if (weights === undefined || weights === null) weights = {}
  if (typeof weights !== 'object' || Array.isArray(weights)) throw invalid('weights', 'weights must be an object')
  const out = {}
  for (const k of KEYS) {
    const v = weights[k]
    if (v === undefined || v === null) {
      out[k] = null
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`weights.${k}`, `${k} weight must be a number`)
    if (v < 0) throw invalid(`weights.${k}`, `${k} weight must not be negative`)
    if (v > MAX_WEIGHT) throw invalid(`weights.${k}`, `${k} weight must be at most ${MAX_WEIGHT}`)
    out[k] = v
  }
  return out
}

// POST /api/matching/runs (endpoint #22): runs match_candidates in a transaction, sweeping first.
router.post('/runs', async (req, res, next) => {
  try {
    const organId = typeof req.body?.organId === 'number' ? req.body.organId : null
    if (!Number.isInteger(organId) || organId < 1) throw invalid('organId', 'organId must be an integer id')
    const w = parseWeights(req.body?.weights)

    const run = await withTx(
      req.session.userId,
      async (client) => {
        const reg = await client.query(
          `SELECT r.hla_weight, r.urgency_weight, r.distance_weight, r.wait_weight
           FROM organ o JOIN hospital h ON h.hospital_id = o.recovering_hospital_id
           JOIN region r ON r.region_id = h.region_id WHERE o.organ_id = $1`,
          [organId],
        )
        if (reg.rowCount === 0) throw new ApiError(404, 'ORGAN_NOT_FOUND', `Organ ${organId} not found`)
        const d = reg.rows[0]
        const effective = [w.hla ?? d.hla_weight, w.urgency ?? d.urgency_weight, w.distance ?? d.distance_weight, w.wait ?? d.wait_weight]
        if (effective.reduce((a, b) => a + Number(b), 0) <= 0) {
          throw invalid('weights', 'At least one weight must be greater than zero')
        }
        const { rows } = await client.query('SELECT match_candidates($1, $2, $3, $4, $5) AS run_id', [
          organId,
          w.hla,
          w.urgency,
          w.distance,
          w.wait,
        ])
        return loadMatchRun(client, rows[0].run_id)
      },
      { sweep: true },
    )
    res.status(201).json(run)
  } catch (err) {
    next(err)
  }
})

// GET /api/matching/runs/:id (endpoint #23)
router.get('/runs/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    const notFound = new ApiError(404, 'MATCH_RUN_NOT_FOUND', `Match run ${req.params.id} not found`)
    if (id === null) throw notFound
    const run = await loadMatchRun(pool, id)
    if (!run) throw notFound
    res.json(run)
  } catch (err) {
    next(err)
  }
})

export default router
