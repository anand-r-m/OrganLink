import { Router } from 'express'
import { pool, query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamel, toCamelRows } from '../util/case.js'
import { ORGAN_SUMMARY_SQL, ORGAN_WITH_WEIGHTS_SQL } from '../util/organSql.js'

const router = Router()

const DONOR_SQL = `
  SELECT d.donor_id AS id, d.name, to_char(d.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         d.blood_group_id, bg.group_name AS blood_group,
         d.hospital_id, h.name AS hospital_name, r.region_code,
         d.donor_type, d.status, d.height_cm, d.weight_kg, d.death_date, d.death_cause,
         (SELECT COUNT(*) FROM organ o WHERE o.donor_id = d.donor_id) AS organ_count
  FROM donor d
  JOIN blood_group bg USING (blood_group_id)
  JOIN hospital h USING (hospital_id)
  JOIN region r USING (region_id)`

const validationError = (field, message) =>
  new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] })

// Donor + HLA + organs, the shape of GET /api/donors/:id. `db` is the pool or a transaction client.
async function loadDonor(db, id) {
  const rows = async (sql, params) => toCamelRows((await db.query(sql, params)).rows)
  const [donor] = await rows(`${DONOR_SQL} WHERE d.donor_id = $1`, [id])
  if (!donor) return null
  const hla = await rows(
    `SELECT a.allele_id AS id, a.locus, a.allele_name
     FROM donor_hla dh JOIN hla_allele a USING (allele_id)
     WHERE dh.donor_id = $1
     ORDER BY CASE a.locus WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, a.allele_name`,
    [id],
  )
  const organs = await rows(ORGAN_SUMMARY_SQL, [id])
  return { ...donor, hla, organs }
}

// GET /api/donors?status=&type=&hospital= (API_CONTRACT endpoint #6). No sweep.
router.get('/', async (req, res, next) => {
  try {
    const { status, type, hospital } = req.query
    const where = []
    const params = []
    if (status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(status)) throw validationError('status', 'status must be ACTIVE or INACTIVE')
      params.push(status)
      where.push(`d.status = $${params.length}`)
    }
    if (type !== undefined) {
      if (!['LIVING', 'DECEASED'].includes(type)) throw validationError('type', 'type must be LIVING or DECEASED')
      params.push(type)
      where.push(`d.donor_type = $${params.length}`)
    }
    if (hospital !== undefined) {
      if (!/^\d+$/.test(hospital)) throw validationError('hospital', 'hospital must be an integer id')
      params.push(Number(hospital))
      where.push(`d.hospital_id = $${params.length}`)
    }
    const sql = `${DONOR_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.donor_id`
    res.json(await query(sql, params))
  } catch (err) {
    next(err)
  }
})

// GET /api/donors/:id (endpoint #8): donor + HLA + organs. Sweeps first so organ statuses are current.
router.get('/:id', async (req, res, next) => {
  try {
    // Ids beyond BIGINT would raise 22003 in Postgres; treat anything unusable as not found.
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const notFound = new ApiError(404, 'DONOR_NOT_FOUND', `Donor ${req.params.id} not found`)
    if (id === null) throw notFound
    await pool.query('SELECT expire_stale_offers()')
    const donor = await loadDonor(pool, id)
    if (!donor) throw notFound
    res.json(donor)
  } catch (err) {
    next(err)
  }
})

const isId = (v) => Number.isSafeInteger(v) && v > 0

// POST /api/donors/:id/organs (endpoint #10): procure an organ, starting its viability clock.
// Sweep first so organ statuses are current. The future-timestamp rule is the DB's
// (ck_organ_not_future), translated to 400 CONSTRAINT_VIOLATION.
router.post('/:id/organs', async (req, res, next) => {
  try {
    const donorId = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const { organTypeId, recoveringHospitalId, recoveredAt } = req.body ?? {}
    const bad = []
    if (!isId(organTypeId)) bad.push('organTypeId')
    if (!isId(recoveringHospitalId)) bad.push('recoveringHospitalId')
    // Offset-bearing ISO 8601 only (contract); Date.parse alone would accept ambiguous local forms.
    const hasOffset = typeof recoveredAt === 'string' && /(Z|[+-]\d{2}:?\d{2})$/i.test(recoveredAt)
    if (!hasOffset || Number.isNaN(Date.parse(recoveredAt))) bad.push('recoveredAt')
    if (bad.length) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid or missing: ${bad.join(', ')}`, { fields: bad })
    }
    const notFound = new ApiError(404, 'DONOR_NOT_FOUND', `Donor ${req.params.id} not found`)
    if (donorId === null) throw notFound

    const organ = await withTx(
      req.session.userId,
      async (client) => {
        const donor = await client.query('SELECT 1 FROM donor WHERE donor_id = $1', [donorId])
        if (donor.rowCount === 0) throw notFound
        const ins = await client.query(
          `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
           VALUES ($1, $2, $3, $4) RETURNING organ_id`,
          [donorId, organTypeId, recoveringHospitalId, recoveredAt],
        )
        const { rows } = await client.query(ORGAN_WITH_WEIGHTS_SQL, [ins.rows[0].organ_id])
        return toCamel(rows[0])
      },
      { sweep: true },
    )
    const { hlaWeight, urgencyWeight, distanceWeight, waitWeight, ...rest } = organ
    res.status(201).json({
      ...rest,
      defaultWeights: { hla: hlaWeight, urgency: urgencyWeight, distance: distanceWeight, wait: waitWeight },
    })
  } catch (err) {
    next(err)
  }
})

const OFFSET_ISO = /(Z|[+-]\d{2}:?\d{2})$/i
const isDateOnly = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const isOffsetTs = (v) => typeof v === 'string' && OFFSET_ISO.test(v) && !Number.isNaN(Date.parse(v))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Shape checks only (types, enums, formats). Value rules (death fields, ranges) belong to the DB.
// `partial` = PATCH: every field optional. Returns the offending field names.
function donorShapeErrors(b, partial) {
  const rules = {
    name: (v) => typeof v === 'string' && v.trim() !== '',
    dateOfBirth: isDateOnly,
    bloodGroupId: isId,
    hospitalId: isId,
    donorType: (v) => v === 'LIVING' || v === 'DECEASED',
    status: (v) => v === 'ACTIVE' || v === 'INACTIVE',
    heightCm: isNum,
    weightKg: isNum,
    deathDate: (v) => v === null || isOffsetTs(v),
    deathCause: (v) => v === null || typeof v === 'string',
    hlaAlleleIds: (v) => Array.isArray(v) && v.every(isId),
  }
  const required = ['name', 'dateOfBirth', 'bloodGroupId', 'hospitalId', 'donorType', 'heightCm', 'weightKg']
  const bad = []
  for (const [field, ok] of Object.entries(rules)) {
    if (b[field] === undefined) {
      if (!partial && required.includes(field)) bad.push(field)
    } else if (!ok(b[field])) bad.push(field)
  }
  return bad
}

const COLUMNS = {
  name: 'name',
  dateOfBirth: 'date_of_birth',
  bloodGroupId: 'blood_group_id',
  hospitalId: 'hospital_id',
  donorType: 'donor_type',
  status: 'status',
  heightCm: 'height_cm',
  weightKg: 'weight_kg',
  deathDate: 'death_date',
  deathCause: 'death_cause',
}

function parseBody(req, partial) {
  const b = req.body
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object', { fields: [] })
  }
  const bad = donorShapeErrors(b, partial)
  if (bad.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid or missing: ${bad.join(', ')}`, { fields: bad })
  }
  return b
}

// Replaces the donor's whole HLA set. Duplicate ids collapse; an unknown id fails the FK (400).
async function replaceHla(client, donorId, ids) {
  await client.query('DELETE FROM donor_hla WHERE donor_id = $1', [donorId])
  const unique = [...new Set(ids)]
  if (unique.length) {
    await client.query('INSERT INTO donor_hla (donor_id, allele_id) SELECT $1, unnest($2::bigint[])', [
      donorId,
      unique,
    ])
  }
}

// POST /api/donors (endpoint #7): create a donor and its HLA set in one transaction.
router.post('/', async (req, res, next) => {
  try {
    const b = parseBody(req, false)
    const fields = Object.keys(COLUMNS).filter((f) => b[f] !== undefined)
    const donor = await withTx(req.session.userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO donor (${fields.map((f) => COLUMNS[f]).join(', ')})
         VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING donor_id`,
        fields.map((f) => b[f]),
      )
      const id = ins.rows[0].donor_id
      if (b.hlaAlleleIds) await replaceHla(client, id, b.hlaAlleleIds)
      return loadDonor(client, id)
    })
    res.status(201).json(donor)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/donors/:id (endpoint #9): any subset of the POST fields; hlaAlleleIds replaces the set.
// The UPDATE always runs (even with no scalar fields) so the donor's audit row records the edit.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null
    const b = parseBody(req, true)
    const notFound = new ApiError(404, 'DONOR_NOT_FOUND', `Donor ${req.params.id} not found`)
    if (id === null) throw notFound
    const fields = Object.keys(COLUMNS).filter((f) => b[f] !== undefined)
    const donor = await withTx(req.session.userId, async (client) => {
      const sets = fields.length
        ? fields.map((f, i) => `${COLUMNS[f]} = $${i + 2}`).join(', ')
        : 'name = name'
      const upd = await client.query(`UPDATE donor SET ${sets} WHERE donor_id = $1`, [
        id,
        ...fields.map((f) => b[f]),
      ])
      if (upd.rowCount === 0) throw notFound
      if (b.hlaAlleleIds) await replaceHla(client, id, b.hlaAlleleIds)
      return loadDonor(client, id)
    })
    res.json(donor)
  } catch (err) {
    next(err)
  }
})

export default router
