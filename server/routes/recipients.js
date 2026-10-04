import { Router } from 'express'
import { pool, query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { WAITLIST_ENTRY_SQL } from '../util/waitlistSql.js'

const router = Router()

// Carries recipient_id so one query can serve a whole page of recipients.
const HLA_SQL = `
  SELECT rh.recipient_id, a.allele_id AS id, a.locus, a.allele_name
  FROM recipient_hla rh
  JOIN hla_allele a ON a.allele_id = rh.allele_id
  WHERE rh.recipient_id = ANY($1::bigint[])
  ORDER BY rh.recipient_id,
           CASE a.locus WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, a.allele_name`

// recipientId -> [{ id, locus, alleleName }]. Recipients with no alleles are simply absent.
async function loadHlaByRecipient(db, ids) {
  const rows = toCamelRows((await db.query(HLA_SQL, [ids])).rows)
  const out = new Map()
  for (const r of rows) {
    if (!out.has(r.recipientId)) out.set(r.recipientId, [])
    out.get(r.recipientId).push({ id: r.id, locus: r.locus, alleleName: r.alleleName })
  }
  return out
}

const RECIPIENT_SQL = `
  SELECT rc.recipient_id AS id, rc.name, to_char(rc.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         rc.blood_group_id, bg.group_name AS blood_group,
         rc.hospital_id, h.name AS hospital_name, rgn.region_code,
         rc.status, rc.height_cm, rc.weight_kg,
         (SELECT COUNT(*) FROM waitlist_entry w WHERE w.recipient_id = rc.recipient_id) AS waitlist_count,
         EXISTS (SELECT 1 FROM organ_offer f
                  WHERE f.recipient_id = rc.recipient_id
                    AND f.status IN ('CREATED', 'SENT')) AS has_open_offer
  FROM recipient rc
  JOIN blood_group bg ON bg.blood_group_id = rc.blood_group_id
  JOIN hospital h ON h.hospital_id = rc.hospital_id
  JOIN region rgn ON rgn.region_id = h.region_id`

const RECIPIENT_STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSPLANTED', 'DECEASED']

const URGENCY_CODES = ['1A', '1B', '2']

const isId = (v) => Number.isSafeInteger(v) && v > 0
const isDateOnly = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const paramId = (v) => (/^\d{1,15}$/.test(v ?? '') ? Number(v) : null)

// GET /api/recipients?organ=&bloodGroup=&urgency=&status= (API_CONTRACT endpoint #11). No sweep.
router.get('/', async (req, res, next) => {
  try {
    const { organ, bloodGroup, urgency, status } = req.query
    const where = []
    const params = []
    if (organ !== undefined) {
      if (!/^\d+$/.test(organ)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'organ must be an integer id', { fields: ['organ'] })
      }
      params.push(Number(organ))
      where.push(
        `EXISTS (SELECT 1 FROM waitlist_entry w WHERE w.recipient_id = rc.recipient_id AND w.organ_type_id = $${params.length})`,
      )
    }
    if (bloodGroup !== undefined) {
      // Unknown group name yields no rows rather than an error: it is a filter, not a reference.
      params.push(bloodGroup)
      where.push(
        `rc.blood_group_id = (SELECT bg2.blood_group_id FROM blood_group bg2 WHERE bg2.group_name = $${params.length})`,
      )
    }
    if (urgency !== undefined) {
      if (!URGENCY_CODES.includes(urgency)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `urgency must be one of ${URGENCY_CODES.join(', ')}`, {
          fields: ['urgency'],
        })
      }
      params.push(urgency)
      where.push(
        `EXISTS (SELECT 1 FROM waitlist_entry w JOIN urgency u ON u.urgency_id = w.urgency_id
                   WHERE w.recipient_id = rc.recipient_id AND u.code = $${params.length})`,
      )
    }
    if (status !== undefined) {
      if (!RECIPIENT_STATUSES.includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `status must be one of ${RECIPIENT_STATUSES.join(', ')}`, {
          fields: ['status'],
        })
      }
      params.push(status)
      where.push(`rc.status = $${params.length}`)
    }
    const sql = `${RECIPIENT_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rc.recipient_id`
    const rows = await query(sql, params)
    // One batched HLA query for the whole page, not one per row.
    const hlaByRecipient = rows.length ? await loadHlaByRecipient(pool, rows.map((r) => r.id)) : new Map()
    for (const r of rows) r.hla = hlaByRecipient.get(r.id) ?? []
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Recipient + HLA + waitlist: the shape of GET /api/recipients/:id, POST and PATCH.
// `db` is the pool or a transaction client.
async function loadRecipient(db, id) {
  const rows = async (sql, params) => toCamelRows((await db.query(sql, params)).rows)
  const [recipient] = await rows(`${RECIPIENT_SQL} WHERE rc.recipient_id = $1`, [id])
  if (!recipient) return null
  const hla = (await loadHlaByRecipient(db, [id])).get(id) ?? []
  const waitlist = await rows(
    `${WAITLIST_ENTRY_SQL} WHERE v.recipient_id = $1 ORDER BY v.priority_score DESC, v.organ_type_id`,
    [id],
  )
  return { ...recipient, hla, waitlist }
}

// Shape checks only (types, enums, formats). Value rules (height/weight ranges, listing date)
// belong to the DB, which reports them as 400 CONSTRAINT_VIOLATION.
const waitlistShapeErrors = (entries) => {
  const bad = []
  entries.forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return bad.push(`waitlist[${i}]`)
    if (!isId(e.organTypeId)) bad.push(`waitlist[${i}].organTypeId`)
    if (!isId(e.urgencyId)) bad.push(`waitlist[${i}].urgencyId`)
    if (e.listedDate !== undefined && !isDateOnly(e.listedDate)) bad.push(`waitlist[${i}].listedDate`)
  })
  return bad
}

// `partial` = PATCH: every field optional. Returns the offending field names.
function recipientShapeErrors(b, partial) {
  const rules = {
    name: (v) => typeof v === 'string' && v.trim() !== '',
    dateOfBirth: isDateOnly,
    bloodGroupId: isId,
    hospitalId: isId,
    status: (v) => RECIPIENT_STATUSES.includes(v),
    heightCm: isNum,
    weightKg: isNum,
    hlaAlleleIds: (v) => Array.isArray(v) && v.every(isId),
    waitlist: (v) => Array.isArray(v),
  }
  const required = ['name', 'dateOfBirth', 'bloodGroupId', 'hospitalId', 'heightCm', 'weightKg']
  const bad = []
  for (const [field, ok] of Object.entries(rules)) {
    if (b[field] === undefined) {
      if (!partial && required.includes(field)) bad.push(field)
    } else if (!ok(b[field])) bad.push(field)
  }
  if (b.waitlist !== undefined) bad.push(...waitlistShapeErrors(b.waitlist))
  return bad
}

const COLUMNS = {
  name: 'name',
  dateOfBirth: 'date_of_birth',
  bloodGroupId: 'blood_group_id',
  hospitalId: 'hospital_id',
  status: 'status',
  heightCm: 'height_cm',
  weightKg: 'weight_kg',
}

function parseBody(req, partial) {
  const b = req.body
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object', { fields: [] })
  }
  // The contract's PATCH subset excludes `waitlist`. Reject it rather than ignore it, so a
  // client never believes it added entries.
  if (partial && b.waitlist !== undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'waitlist cannot be changed through PATCH /api/recipients/:id', {
      fields: ['waitlist'],
    })
  }
  const bad = recipientShapeErrors(b, partial)
  if (bad.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid or missing: ${bad.join(', ')}`, { fields: bad })
  }
  return b
}

// Replaces the recipient's whole HLA set. Duplicate ids collapse; an unknown id fails the FK (400).
async function replaceRecipientHla(client, recipientId, ids) {
  await client.query('DELETE FROM recipient_hla WHERE recipient_id = $1', [recipientId])
  const unique = [...new Set(ids)]
  if (unique.length) {
    await client.query(
      'INSERT INTO recipient_hla (recipient_id, allele_id) SELECT $1, unnest($2::bigint[])',
      [recipientId, unique],
    )
  }
}

// Initial waitlist entries, inserted in the caller's transaction so a bad entry rolls the
// recipient back too. A repeated organ type trips the PK and becomes 409 DUPLICATE.
async function insertWaitlist(client, recipientId, entries) {
  for (const e of entries) {
    await client.query(
      `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
      [recipientId, e.organTypeId, e.urgencyId, e.listedDate ?? null],
    )
  }
}

// POST /api/recipients (endpoint #12): recipient, HLA set and optional waitlist in one transaction.
router.post('/', async (req, res, next) => {
  try {
    const b = parseBody(req, false)
    const fields = Object.keys(COLUMNS).filter((f) => b[f] !== undefined)
    const recipient = await withTx(req.session.userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO recipient (${fields.map((f) => COLUMNS[f]).join(', ')})
         VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING recipient_id`,
        fields.map((f) => b[f]),
      )
      const id = ins.rows[0].recipient_id
      if (b.hlaAlleleIds) await replaceRecipientHla(client, id, b.hlaAlleleIds)
      if (Array.isArray(b.waitlist)) await insertWaitlist(client, id, b.waitlist)
      return loadRecipient(client, id)
    })
    res.status(201).json(recipient)
  } catch (err) {
    next(err)
  }
})

// GET /api/recipients/:id (endpoint #13). No sweep: the contract's Sweep column is "no".
router.get('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const notFound = new ApiError(404, 'RECIPIENT_NOT_FOUND', `Recipient ${req.params.id} not found`)
    if (id === null) throw notFound
    const recipient = await loadRecipient(pool, id)
    if (!recipient) throw notFound
    res.json(recipient)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/recipients/:id (endpoint #14): any subset of the POST fields; hlaAlleleIds replaces
// the set. The UPDATE always runs (even with no scalar fields) so the audit trigger records the
// edit. Setting a non-ACTIVE status voids the recipient's open offers on the next sweep
// (expire_stale_offers step 5), which no endpoint here triggers.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const b = parseBody(req, true)
    const notFound = new ApiError(404, 'RECIPIENT_NOT_FOUND', `Recipient ${req.params.id} not found`)
    if (id === null) throw notFound
    const fields = Object.keys(COLUMNS).filter((f) => b[f] !== undefined)
    const recipient = await withTx(req.session.userId, async (client) => {
      const sets = fields.length
        ? fields.map((f, i) => `${COLUMNS[f]} = $${i + 2}`).join(', ')
        : 'name = name'
      const upd = await client.query(`UPDATE recipient SET ${sets} WHERE recipient_id = $1`, [
        id,
        ...fields.map((f) => b[f]),
      ])
      if (upd.rowCount === 0) throw notFound
      if (b.hlaAlleleIds) await replaceRecipientHla(client, id, b.hlaAlleleIds)
      return loadRecipient(client, id)
    })
    res.json(recipient)
  } catch (err) {
    next(err)
  }
})

export default router
