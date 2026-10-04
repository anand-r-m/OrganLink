import { Router } from 'express'
import { pool, query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamel } from '../util/case.js'
import { listOrganRuns } from '../util/matchRunSql.js'
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

// Organ with the region's default match weights, in the contract's Organ shape (GET /:id, discard).
const loadOrganWithWeights = async (db, id) => {
  const { rows } = await db.query(ORGAN_WITH_WEIGHTS_SQL, [id])
  if (rows.length === 0) return null
  const { hlaWeight, urgencyWeight, distanceWeight, waitWeight, ...rest } = toCamel(rows[0])
  return {
    ...rest,
    defaultWeights: { hla: hlaWeight, urgency: urgencyWeight, distance: distanceWeight, wait: waitWeight },
  }
}

// GET /api/organs/:id (endpoint #19): organ plus the region's default match weights. Sweeps first.
router.get('/:id', async (req, res, next) => {
  try {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const notFound = new ApiError(404, 'ORGAN_NOT_FOUND', `Organ ${req.params.id} not found`)
    if (id === null) throw notFound
    await pool.query('SELECT expire_stale_offers()')
    const organ = await loadOrganWithWeights(pool, id)
    if (!organ) throw notFound
    res.json(organ)
  } catch (err) {
    next(err)
  }
})

// POST /api/organs/:id/discard {discardReasonId}: AVAILABLE or EXPIRED -> DISCARDED. Sweeps first.
// The schema leaves an open offer dangling if its organ is discarded and no DB rule covers it, so the
// open-offer check is an API decision (A17); the status transition itself is also guarded by the trigger.
router.post('/:id/discard', async (req, res, next) => {
  try {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const notFound = new ApiError(404, 'ORGAN_NOT_FOUND', `Organ ${req.params.id} not found`)
    if (id === null) throw notFound
    const reasonId = req.body?.discardReasonId
    if (!Number.isInteger(reasonId) || reasonId < 1 || reasonId > 999999999999999) {
      throw validationError('discardReasonId', 'discardReasonId must be an integer id')
    }
    const organ = await withTx(
      req.session.userId,
      async (client) => {
        const cur = await client.query('SELECT status FROM organ WHERE organ_id = $1 FOR UPDATE', [id])
        if (cur.rowCount === 0) throw notFound
        const { status } = cur.rows[0]
        if (status !== 'AVAILABLE' && status !== 'EXPIRED') {
          throw new ApiError(
            409,
            'INVALID_STATE_TRANSITION',
            `Organ ${id} is ${status}; only an AVAILABLE or EXPIRED organ can be discarded`,
            { currentStatus: status, requiredStatus: 'AVAILABLE or EXPIRED' },
          )
        }
        const open = await client.query(
          `SELECT offer_id FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT') LIMIT 1`,
          [id],
        )
        if (open.rowCount > 0) {
          throw new ApiError(
            409,
            'ACTIVE_OFFER_EXISTS',
            'This organ already has an active offer; cancel it before discarding the organ',
            { offerId: open.rows[0].offer_id },
          )
        }
        await client.query(
          `UPDATE organ SET status = 'DISCARDED', discard_reason_id = $2
           WHERE organ_id = $1 AND status IN ('AVAILABLE','EXPIRED')`,
          [id, reasonId],
        )
        return loadOrganWithWeights(client, id)
      },
      { sweep: true },
    )
    res.json(organ)
  } catch (err) {
    next(err)
  }
})

// GET /api/organs/:id/runs (endpoint #21): saved match runs, newest first. Sweeps first.
router.get('/:id/runs', async (req, res, next) => {
  try {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const notFound = new ApiError(404, 'ORGAN_NOT_FOUND', `Organ ${req.params.id} not found`)
    if (id === null) throw notFound
    await pool.query('SELECT expire_stale_offers()')
    const organ = await pool.query('SELECT 1 FROM organ WHERE organ_id = $1', [id])
    if (organ.rowCount === 0) throw notFound
    res.json(await listOrganRuns(pool, id))
  } catch (err) {
    next(err)
  }
})

export default router
