import { Router } from 'express'
import { pool, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { adaptOfferRow, loadOffer, offerSql } from '../util/offerSql.js'

const router = Router()

const STATUSES = ['CREATED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED']
const invalid = (field, message) => new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] })
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null)
const notFound = (id) => new ApiError(404, 'OFFER_NOT_FOUND', `Offer ${id} not found`)
const isId = (v) => Number.isInteger(v) && v >= 1 && v <= 999999999999999

// GET /api/offers?status=&organId= (API_CONTRACT endpoint #24). Sweeps first.
router.get('/', async (req, res, next) => {
  try {
    const { status, organId } = req.query
    const where = ['TRUE']
    const params = []
    if (status !== undefined) {
      const list = String(status).split(',')
      if (list.some((s) => !STATUSES.includes(s))) {
        throw invalid('status', `status must be one or more of ${STATUSES.join(', ')}`)
      }
      params.push(list)
      where.push(`v.status = ANY($${params.length}::text[])`)
    }
    if (organId !== undefined) {
      const id = parseId(organId)
      if (id === null) throw invalid('organId', 'organId must be an integer id')
      params.push(id)
      where.push(`v.organ_id = $${params.length}`)
    }
    await pool.query('SELECT expire_stale_offers()')
    const { rows } = await pool.query(offerSql(where.join(' AND '), 'ORDER BY v.created_at DESC, v.offer_id DESC'), params)
    res.json(rows.map(adaptOfferRow))
  } catch (err) {
    next(err)
  }
})

// GET /api/offers/:id (endpoint #25, proposed). Sweeps first.
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) throw notFound(req.params.id)
    await pool.query('SELECT expire_stale_offers()')
    const offer = await loadOffer(pool, id)
    if (!offer) throw notFound(id)
    res.json(offer)
  } catch (err) {
    next(err)
  }
})

// POST /api/offers (endpoint #26): the organ is locked FOR UPDATE, then the offer is inserted.
// The DB triggers and unique indexes enforce every rule; the error handler translates them.
router.post('/', async (req, res, next) => {
  try {
    const { organId, recipientId, matchRunId = null } = req.body ?? {}
    if (!isId(organId)) throw invalid('organId', 'organId must be an integer id')
    if (!isId(recipientId)) throw invalid('recipientId', 'recipientId must be an integer id')
    if (matchRunId !== null && !isId(matchRunId)) throw invalid('matchRunId', 'matchRunId must be an integer id')

    const offer = await withTx(
      req.session.userId,
      async (client) => {
        const lock = await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [organId])
        if (lock.rowCount === 0) {
          throw new ApiError(400, 'REFERENCE_NOT_FOUND', 'Referenced record does not exist', { constraint: 'organ_offer_organ_id_fkey' })
        }
        if (matchRunId !== null) {
          const run = await client.query('SELECT organ_id FROM match_run WHERE run_id = $1', [matchRunId])
          if (run.rowCount > 0 && run.rows[0].organ_id !== organId) {
            throw invalid('matchRunId', `Match run ${matchRunId} belongs to a different organ`)
          }
        }
        const { rows } = await client.query(
          `INSERT INTO organ_offer (organ_id, recipient_id, run_id, created_by)
           VALUES ($1, $2, $3, $4) RETURNING offer_id`,
          [organId, recipientId, matchRunId, req.session.userId],
        )
        return loadOffer(client, rows[0].offer_id)
      },
      { sweep: true },
    )
    res.status(201).json(offer)
  } catch (err) {
    next(err)
  }
})

// Conditional transition (A2): UPDATE ... WHERE status = ANY(required). 0 rows -> 404 or 409.
function transition(action, required, setSql) {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      const id = parseId(req.params.id)
      if (id === null) throw notFound(req.params.id)
      const offer = await withTx(
        req.session.userId,
        async (client) => {
          const cur = await client.query('SELECT organ_id FROM organ_offer WHERE offer_id = $1', [id])
          if (cur.rowCount === 0) throw notFound(id)
          await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [cur.rows[0].organ_id])
          const upd = await client.query(
            `UPDATE organ_offer SET ${setSql} WHERE offer_id = $1 AND status = ANY($2::text[]) RETURNING offer_id`,
            [id, required],
          )
          if (upd.rowCount === 0) {
            const now = await client.query('SELECT status, void_reason FROM organ_offer WHERE offer_id = $1', [id])
            const { status, void_reason: voidReason } = now.rows[0]
            throw new ApiError(
              409,
              'INVALID_STATE_TRANSITION',
              `Offer ${id} is ${status}; this action requires ${required.join(' or ')}`,
              { currentStatus: status, requiredStatus: required.join(' or '), ...(voidReason ? { voidReason } : {}) },
            )
          }
          return loadOffer(client, id)
        },
        { sweep: true },
      )
      res.json(offer)
    } catch (err) {
      next(err)
    }
  })
}

// POST /api/offers/:id/send (endpoint #27): starts the response window (BR-9).
transition('send', ['CREATED'], `status = 'SENT', sent_at = now()`)
// POST /api/offers/:id/cancel (endpoint #30): withdraws without a decision; no re-offer block (U9).
transition('cancel', ['CREATED', 'SENT'], `status = 'CANCELLED'`)

export default router
