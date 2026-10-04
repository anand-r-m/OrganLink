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
// `extra` may return { set, params } to add columns (placeholders start at $3) and to validate input.
function transition(action, required, setSql, extra) {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      const id = parseId(req.params.id)
      if (id === null) throw notFound(req.params.id)
      const more = extra ? extra(req.body ?? {}) : { set: '', params: [] }
      const offer = await withTx(
        req.session.userId,
        async (client) => {
          const cur = await client.query('SELECT organ_id FROM organ_offer WHERE offer_id = $1', [id])
          if (cur.rowCount === 0) throw notFound(id)
          await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [cur.rows[0].organ_id])
          const upd = await client.query(
            `UPDATE organ_offer SET ${setSql}${more.set} WHERE offer_id = $1 AND status = ANY($2::text[]) RETURNING offer_id`,
            [id, required, ...more.params],
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

const optionalNotes = (body) => {
  if (body.notes === undefined || body.notes === null) return null
  if (typeof body.notes !== 'string') throw invalid('notes', 'notes must be a string')
  return body.notes.trim() === '' ? null : body.notes.trim()
}

// POST /api/offers/:id/send (endpoint #27): starts the response window (BR-9).
transition('send', ['CREATED'], `status = 'SENT', sent_at = now()`)
// POST /api/offers/:id/cancel (endpoint #30): withdraws without a decision; no re-offer block (U9).
transition('cancel', ['CREATED', 'SENT'], `status = 'CANCELLED'`)

// POST /api/offers/:id/accept (endpoint #28): the DB triggers allocate the organ and create transport.
transition('accept', ['SENT'], `status = 'ACCEPTED', responded_at = now()`, (body) => ({
  set: ', notes = COALESCE($3, notes)',
  params: [optionalNotes(body)],
}))
// POST /api/offers/:id/decline (endpoint #29): coded reason required (FR-9); blocks a re-offer (BR-10).
transition('decline', ['SENT'], `status = 'DECLINED', responded_at = now()`, (body) => {
  if (!isId(body.declineReasonId)) throw invalid('declineReasonId', 'declineReasonId is required')
  return { set: ', decline_reason_id = $3, notes = COALESCE($4, notes)', params: [body.declineReasonId, optionalNotes(body)] }
})

const ADVANCE_FROM = ['DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED']

// POST /api/offers/:id/advance (endpoint #31, A4): offer the organ to the next ranked candidate of the
// same run. Each attempt runs under a SAVEPOINT so a trigger or index failure only skips that candidate.
router.post('/:id/advance', async (req, res, next) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) throw notFound(req.params.id)
    const result = await withTx(
      req.session.userId,
      async (client) => {
        const cur = await client.query('SELECT organ_id FROM organ_offer WHERE offer_id = $1', [id])
        if (cur.rowCount === 0) throw notFound(id)
        const organId = cur.rows[0].organ_id
        await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [organId])
        const src = (await client.query('SELECT status, run_id, recipient_id FROM organ_offer WHERE offer_id = $1', [id])).rows[0]
        if (!ADVANCE_FROM.includes(src.status) || src.run_id === null) {
          throw new ApiError(
            409,
            'INVALID_STATE_TRANSITION',
            src.run_id === null && ADVANCE_FROM.includes(src.status)
              ? `Offer ${id} has no match run, so it cannot be advanced`
              : `Offer ${id} is ${src.status}; advance requires ${ADVANCE_FROM.join(', ')}`,
            { currentStatus: src.status, requiredStatus: ADVANCE_FROM.join(' or '), matchRunId: src.run_id },
          )
        }
        const open = await client.query(`SELECT 1 FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT')`, [organId])
        if (open.rowCount > 0) throw new ApiError(409, 'ACTIVE_OFFER_EXISTS', 'This organ already has an active offer')

        const { rows: cands } = await client.query(
          `SELECT mr.rank, mr.recipient_id, r.name AS recipient_name
             FROM match_result mr JOIN recipient r ON r.recipient_id = mr.recipient_id
            WHERE mr.run_id = $1 AND mr.qualified
              AND mr.rank > COALESCE((SELECT rank FROM match_result WHERE run_id = $1 AND recipient_id = $2), 0)
            ORDER BY mr.rank`,
          [src.run_id, src.recipient_id],
        )
        const skipped = []
        for (const c of cands) {
          await client.query('SAVEPOINT advance_try')
          try {
            const ins = await client.query(
              `INSERT INTO organ_offer (organ_id, recipient_id, run_id, created_by) VALUES ($1, $2, $3, $4) RETURNING offer_id`,
              [organId, c.recipient_id, src.run_id, req.session.userId],
            )
            await client.query('RELEASE SAVEPOINT advance_try')
            return { offer: await loadOffer(client, ins.rows[0].offer_id), skipped }
          } catch (err) {
            if (err.code !== 'P0001' && err.code !== '23505') throw err
            // Organ-level failures end the walk: no later candidate could succeed either.
            if (err.code === 'P0001' && /^Organ /.test(err.message)) throw err
            await client.query('ROLLBACK TO SAVEPOINT advance_try')
            await client.query('RELEASE SAVEPOINT advance_try')
            skipped.push({
              rank: c.rank,
              recipientId: c.recipient_id,
              recipientName: c.recipient_name,
              reasonCode: err.code === '23505' ? 'RECIPIENT_ALREADY_DECLINED' : 'RULE_VIOLATION',
              reason: err.code === '23505' ? 'This recipient has already declined this organ' : err.message,
            })
          }
        }
        throw new ApiError(422, 'NO_ELIGIBLE_CANDIDATE', 'No remaining ranked candidate could be offered', { skipped })
      },
      { sweep: true },
    )
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

export default router
