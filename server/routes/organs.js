import { Router } from 'express'
import { pool, query } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamel } from '../util/case.js'
import { ORGAN_WITH_WEIGHTS_SQL, organSql } from '../util/organSql.js'

const router = Router()

const STATUSES = ['AVAILABLE', 'ALLOCATED', 'TRANSPLANTED', 'EXPIRED', 'DISCARDED']
const validationError = (field, message) =>
  new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] })

// GET /api/organs?status=&available=&organTypeId= (API_CONTRACT endpoint #18). Sweeps first.
router.get('/', async (req, res, next) => {
  try {
    const { status, available, organTypeId } = req.query
    const where = ['TRUE']
    const params = []
    if (status !== undefined) {
      if (!STATUSES.includes(status)) throw validationError('status', `status must be one of ${STATUSES.join(', ')}`)
      params.push(status)
      where.push(`v.status = $${params.length}`)
    }
    if (available !== undefined) {
      if (!['true', 'false'].includes(available)) throw validationError('available', 'available must be true or false')
      if (available === 'true') where.push(`v.status = 'AVAILABLE' AND NOT v.is_expired`)
    }
    if (organTypeId !== undefined) {
      if (!/^\d{1,9}$/.test(organTypeId)) throw validationError('organTypeId', 'organTypeId must be an integer id')
      params.push(Number(organTypeId))
      where.push(`v.organ_type_id = $${params.length}`)
    }
    await pool.query('SELECT expire_stale_offers()')
    res.json(await query(organSql(where.join(' AND '), 'ORDER BY v.recovered_at DESC, v.organ_id DESC'), params))
  } catch (err) {
    next(err)
  }
})

// GET /api/organs/:id (endpoint #19): organ plus the region's default match weights. Sweeps first.
router.get('/:id', async (req, res, next) => {
  try {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const notFound = new ApiError(404, 'ORGAN_NOT_FOUND', `Organ ${req.params.id} not found`)
    if (id === null) throw notFound
    await pool.query('SELECT expire_stale_offers()')
    const { rows } = await pool.query(ORGAN_WITH_WEIGHTS_SQL, [id])
    if (rows.length === 0) throw notFound
    const { hlaWeight, urgencyWeight, distanceWeight, waitWeight, ...rest } = toCamel(rows[0])
    res.json({
      ...rest,
      defaultWeights: { hla: hlaWeight, urgency: urgencyWeight, distance: distanceWeight, wait: waitWeight },
    })
  } catch (err) {
    next(err)
  }
})

export default router
