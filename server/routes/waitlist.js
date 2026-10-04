import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { WAITLIST_ENTRY_SQL } from '../util/waitlistSql.js'

const router = Router()

const URGENCY_CODES = ['1A', '1B', '2']
const ENTRY_STATUSES = ['ACTIVE', 'SUSPENDED', 'TRANSPLANTED', 'REMOVED']
// TRANSPLANTED is set only by the transplant trigger (API_CONTRACT PATCH /api/waitlist).
const PATCH_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED']

const isId = (v) => Number.isSafeInteger(v) && v > 0
const isDateOnly = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const paramId = (v) => (/^\d{1,15}$/.test(v ?? '') ? Number(v) : null)

const validation = (message, fields) => new ApiError(400, 'VALIDATION_ERROR', message, { fields })

const ORDER = 'ORDER BY v.priority_score DESC, v.recipient_id, v.organ_type_id'

// `db` is the pool or a transaction client.
async function loadEntry(db, recipientId, organTypeId) {
  const rows = toCamelRows(
    (await db.query(`${WAITLIST_ENTRY_SQL} WHERE v.recipient_id = $1 AND v.organ_type_id = $2`, [
      recipientId,
      organTypeId,
    ])).rows,
  )
  return rows[0] ?? null
}

// GET /api/waitlist?organ=&bloodGroup=&urgency=&status= (API_CONTRACT). No sweep.
router.get('/', async (req, res, next) => {
  try {
    const { organ, bloodGroup, urgency, status } = req.query
    const where = []
    const params = []
    if (organ !== undefined) {
      if (!/^\d{1,15}$/.test(organ)) throw validation('organ must be an integer id', ['organ'])
      params.push(Number(organ))
      where.push(`v.organ_type_id = $${params.length}`)
    }
    if (bloodGroup !== undefined) {
      // Unknown group name yields no rows: it is a filter, not a reference.
      params.push(bloodGroup)
      where.push(`bg.group_name = $${params.length}`)
    }
    if (urgency !== undefined) {
      if (!URGENCY_CODES.includes(urgency)) {
        throw validation(`urgency must be one of ${URGENCY_CODES.join(', ')}`, ['urgency'])
      }
      params.push(urgency)
      where.push(`v.urgency_code = $${params.length}`)
    }
    if (status !== undefined) {
      if (!ENTRY_STATUSES.includes(status)) {
        throw validation(`status must be one of ${ENTRY_STATUSES.join(', ')}`, ['status'])
      }
      params.push(status)
      where.push(`v.status = $${params.length}`)
    }
    const sql = `${WAITLIST_ENTRY_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${ORDER}`
    res.json(await query(sql, params))
  } catch (err) {
    next(err)
  }
})

function requireObject(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw validation('Request body must be a JSON object', [])
  }
}

// POST /api/waitlist: add an organ-type listing. Duplicate PK -> 409, future date -> 400
// (ck_waitlist_not_future), unknown reference -> 400; all translated from the DB error.
router.post('/', async (req, res, next) => {
  try {
    const b = req.body
    requireObject(b)
    const bad = []
    if (!isId(b.recipientId)) bad.push('recipientId')
    if (!isId(b.organTypeId)) bad.push('organTypeId')
    if (!isId(b.urgencyId)) bad.push('urgencyId')
    if (b.listedDate !== undefined && b.listedDate !== null && !isDateOnly(b.listedDate)) bad.push('listedDate')
    if (bad.length) throw validation(`Invalid or missing: ${bad.join(', ')}`, bad)
    const entry = await withTx(req.session.userId, async (client) => {
      await client.query(
        `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
        [b.recipientId, b.organTypeId, b.urgencyId, b.listedDate ?? null],
      )
      return loadEntry(client, b.recipientId, b.organTypeId)
    })
    res.status(201).json(entry)
  } catch (err) {
    next(err)
  }
})

const PATCH_COLUMNS = { urgencyId: 'urgency_id', status: 'status', listedDate: 'listed_date' }

// PATCH /api/waitlist/:recipientId/:organTypeId: urgency, status (not TRANSPLANTED), listed date.
router.patch('/:recipientId/:organTypeId', async (req, res, next) => {
  try {
    const recipientId = paramId(req.params.recipientId)
    const organTypeId = paramId(req.params.organTypeId)
    const b = req.body
    requireObject(b)
    const bad = []
    if (b.urgencyId !== undefined && !isId(b.urgencyId)) bad.push('urgencyId')
    if (b.status !== undefined && !PATCH_STATUSES.includes(b.status)) bad.push('status')
    if (b.listedDate !== undefined && !isDateOnly(b.listedDate)) bad.push('listedDate')
    if (bad.length) throw validation(`Invalid: ${bad.join(', ')}`, bad)
    const notFound = new ApiError(
      404,
      'WAITLIST_ENTRY_NOT_FOUND',
      `Waitlist entry ${req.params.recipientId}/${req.params.organTypeId} not found`,
    )
    if (recipientId === null || organTypeId === null) throw notFound
    const fields = Object.keys(PATCH_COLUMNS).filter((f) => b[f] !== undefined)
    const entry = await withTx(req.session.userId, async (client) => {
      // Always UPDATE (even with no fields) so the audit trigger records the edit.
      const sets = fields.length
        ? fields.map((f, i) => `${PATCH_COLUMNS[f]} = $${i + 3}`).join(', ')
        : 'status = status'
      const upd = await client.query(
        `UPDATE waitlist_entry SET ${sets} WHERE recipient_id = $1 AND organ_type_id = $2`,
        [recipientId, organTypeId, ...fields.map((f) => b[f])],
      )
      if (upd.rowCount === 0) throw notFound
      return loadEntry(client, recipientId, organTypeId)
    })
    res.json(entry)
  } catch (err) {
    next(err)
  }
})

export default router
