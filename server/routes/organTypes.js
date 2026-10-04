import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { ORGAN_TYPE_SQL, checkShape, paramId, pick } from '../util/settingsSql.js'

const router = Router()

const COLUMNS = {
  name: 'name',
  maxViabilityHours: 'max_viability_hours',
  responseWindowHours: 'response_window_hours',
  priorityWeight: 'priority_weight',
  minWeightRatio: 'min_weight_ratio',
  maxWeightRatio: 'max_weight_ratio',
}
const SPEC = {
  name: 'string',
  maxViabilityHours: 'number',
  responseWindowHours: 'number',
  priorityWeight: 'number',
  minWeightRatio: 'number',
  maxWeightRatio: 'number',
}

async function loadType(db, id) {
  const { rows } = await db.query(`${ORGAN_TYPE_SQL} WHERE organ_type_id = $1`, [id])
  return rows.length ? toCamelRows(rows)[0] : null
}

// GET /api/organ-types
router.get('/', async (_req, res, next) => {
  try {
    res.json(await query(`${ORGAN_TYPE_SQL} ORDER BY organ_type_id`))
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    checkShape(req.body, SPEC)
    const { cols, vals } = pick(req.body, COLUMNS)
    const type = await withTx(req.session.userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO organ_type (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING organ_type_id`,
        vals,
      )
      return loadType(client, ins.rows[0].organ_type_id)
    })
    res.status(201).json(type)
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const notFound = new ApiError(404, 'ORGAN_TYPE_NOT_FOUND', `Organ type ${req.params.id} not found`)
    if (id === null) throw notFound
    checkShape(req.body, SPEC)
    const { cols, vals } = pick(req.body, COLUMNS)
    const type = await withTx(req.session.userId, async (client) => {
      if (cols.length) {
        const upd = await client.query(
          `UPDATE organ_type SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE organ_type_id = $1`,
          [id, ...vals],
        )
        if (upd.rowCount === 0) throw notFound
      }
      const t = await loadType(client, id)
      if (!t) throw notFound
      return t
    })
    res.json(type)
  } catch (err) {
    next(err)
  }
})

export default router
