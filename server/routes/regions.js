import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { REGION_SQL, checkShape, paramId, pick } from '../util/settingsSql.js'

const router = Router()

const COLUMNS = { code: 'region_code', name: 'region_name' }
const WEIGHT_COLUMNS = {
  hla: 'hla_weight',
  urgency: 'urgency_weight',
  distance: 'distance_weight',
  wait: 'wait_weight',
}

const shape = (r) => {
  const { hlaWeight, urgencyWeight, distanceWeight, waitWeight, ...rest } = r
  return { ...rest, weights: { hla: hlaWeight, urgency: urgencyWeight, distance: distanceWeight, wait: waitWeight } }
}

async function loadRegion(db, id) {
  const { rows } = await db.query(`${REGION_SQL} WHERE r.region_id = $1`, [id])
  return rows.length ? shape(toCamelRows(rows)[0]) : null
}

// Flattens {name, code, weights:{...}} into one {field: value} map keyed by column.
function parseBody(body) {
  checkShape(body, { code: 'string', name: 'string', weights: 'object' })
  const weights = body.weights ?? {}
  if (Array.isArray(weights) || weights === null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'weights must be an object', { fields: ['weights'] })
  }
  checkShape(weights, Object.fromEntries(Object.keys(WEIGHT_COLUMNS).map((k) => [k, 'number'])))
  const a = pick(body, COLUMNS)
  const b = pick(weights, WEIGHT_COLUMNS)
  return { cols: [...a.cols, ...b.cols], vals: [...a.vals, ...b.vals] }
}

// GET /api/regions
router.get('/', async (_req, res, next) => {
  try {
    res.json((await query(`${REGION_SQL} ORDER BY r.region_id`)).map(shape))
  } catch (err) {
    next(err)
  }
})

// POST /api/regions: omitted weights take the column defaults.
router.post('/', async (req, res, next) => {
  try {
    const { cols, vals } = parseBody(req.body)
    const region = await withTx(req.session.userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO region (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING region_id`,
        vals,
      )
      return loadRegion(client, ins.rows[0].region_id)
    })
    res.status(201).json(region)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/regions/:id: only the supplied weight keys change.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const notFound = new ApiError(404, 'REGION_NOT_FOUND', `Region ${req.params.id} not found`)
    if (id === null) throw notFound
    const { cols, vals } = parseBody(req.body)
    const region = await withTx(req.session.userId, async (client) => {
      if (cols.length) {
        const upd = await client.query(
          `UPDATE region SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE region_id = $1`,
          [id, ...vals],
        )
        if (upd.rowCount === 0) throw notFound
      }
      const r = await loadRegion(client, id)
      if (!r) throw notFound
      return r
    })
    res.json(region)
  } catch (err) {
    next(err)
  }
})

export default router
