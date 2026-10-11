import { Router } from 'express'
import { pool, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { adaptTransportRow, loadTransport, transportSql } from '../util/transportSql.js'

const router = Router()

const STATUSES = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED']
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null)
const notFound = (id) => new ApiError(404, 'TRANSPORT_NOT_FOUND', `Transport ${id} not found`)

// GET /api/transport?status= (API_CONTRACT endpoint #33). Sweeps first; active transports lead.
router.get('/', async (req, res, next) => {
  try {
    // Discarded organs are out of the logistics view; their transport rows are kept, just not listed.
    const where = [`v.status <> 'DISCARDED'`]
    const params = []
    if (req.query.status !== undefined) {
      const list = String(req.query.status).split(',')
      if (list.some((s) => !STATUSES.includes(s))) {
        throw new ApiError(400, 'VALIDATION_ERROR', `status must be one or more of ${STATUSES.join(', ')}`, { fields: ['status'] })
      }
      params.push(list)
      where.push(`t.status = ANY($${params.length}::text[])`)
    }
    await pool.query('SELECT expire_stale_offers()')
    const orderBy = `ORDER BY (t.status IN ('PENDING','IN_TRANSIT')) DESC, t.transport_id DESC`
    const { rows } = await pool.query(transportSql(where.join(' AND '), orderBy), params)
    res.json(rows.map(adaptTransportRow))
  } catch (err) {
    next(err)
  }
})

// Conditional transition (A2): UPDATE ... WHERE status = required. 0 rows -> 404 or 409.
// The organ is locked first, as the offer transitions do, so the two flows serialise.
function transition(action, required, setSql, guard = null) {
  router.post(`/:id/${action}`, async (req, res, next) => {
    try {
      const id = parseId(req.params.id)
      if (id === null) throw notFound(req.params.id)
      const transport = await withTx(
        req.session.userId,
        async (client) => {
          const cur = await client.query('SELECT organ_id FROM transport_record WHERE transport_id = $1', [id])
          if (cur.rowCount === 0) throw notFound(id)
          const organId = cur.rows[0].organ_id
          await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [organId])
          if (guard) await guard(client, id, organId)
          const upd = await client.query(
            `UPDATE transport_record SET ${setSql} WHERE transport_id = $1 AND status = $2 RETURNING transport_id`,
            [id, required],
          )
          if (upd.rowCount === 0) {
            const now = await client.query('SELECT status FROM transport_record WHERE transport_id = $1', [id])
            const { status } = now.rows[0]
            throw new ApiError(
              409,
              'INVALID_STATE_TRANSITION',
              `Transport ${id} is ${status}; this action requires ${required}`,
              { currentStatus: status, requiredStatus: required },
            )
          }
          return loadTransport(client, id)
        },
        { sweep: true },
      )
      res.json(transport)
    } catch (err) {
      next(err)
    }
  })
}

// OL-042: a PENDING transport whose organ's viability has elapsed cannot be dispatched. Any other
// status falls through to the usual "requires PENDING" 409.
async function viableToDepart(client, id, organId) {
  const { rows } = await client.query(
    `SELECT t.status, v.is_expired FROM transport_record t JOIN v_organ v ON v.organ_id = t.organ_id
     WHERE t.transport_id = $1`,
    [id],
  )
  if (rows[0].status === 'PENDING' && rows[0].is_expired) {
    throw new ApiError(
      409,
      'INVALID_STATE_TRANSITION',
      `Organ ${organId} viability window has elapsed; it cannot be dispatched`,
      { currentStatus: 'PENDING', organId },
    )
  }
}

// POST /api/transport/:id/depart (endpoint #34): PENDING -> IN_TRANSIT.
transition('depart', 'PENDING', `status = 'IN_TRANSIT', departed_at = now()`, viableToDepart)
// POST /api/transport/:id/deliver (endpoint #35): IN_TRANSIT -> DELIVERED. No expiry check (OL-DEC-02, A).
transition('deliver', 'IN_TRANSIT', `status = 'DELIVERED', arrived_at = now()`)

export default router
