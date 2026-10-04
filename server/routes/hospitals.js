import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'
import { checkShape, paramId, pick } from '../util/settingsSql.js'

const router = Router()

export const HOSPITAL_SQL = `
  SELECT h.hospital_id AS id, h.name, h.address, h.phone, h.latitude, h.longitude,
         h.region_id, r.region_code, r.region_name, h.status
  FROM hospital h JOIN region r USING (region_id)`

// GET /api/hospitals?regionId=&status= (API_CONTRACT endpoint #42). POST/PATCH below (OL-024).
router.get('/', async (req, res, next) => {
  try {
    const { regionId, status } = req.query
    const where = []
    const params = []
    if (regionId !== undefined) {
      if (!/^\d+$/.test(regionId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'regionId must be an integer', { fields: ['regionId'] })
      }
      params.push(Number(regionId))
      where.push(`h.region_id = $${params.length}`)
    }
    if (status !== undefined) {
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'status must be ACTIVE or SUSPENDED', {
          fields: ['status'],
        })
      }
      params.push(status)
      where.push(`h.status = $${params.length}`)
    }
    const sql = `${HOSPITAL_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY h.hospital_id`
    res.json(await query(sql, params))
  } catch (err) {
    next(err)
  }
})

const COLUMNS = {
  name: 'name',
  address: 'address',
  phone: 'phone',
  latitude: 'latitude',
  longitude: 'longitude',
  regionId: 'region_id',
  status: 'status',
}
const SPEC = {
  name: 'string',
  address: 'string?',
  phone: 'string?',
  latitude: 'number',
  longitude: 'number',
  regionId: 'number',
  status: 'string',
}

async function loadHospital(db, id) {
  const { rows } = await db.query(`${HOSPITAL_SQL} WHERE h.hospital_id = $1`, [id])
  return rows.length ? toCamelRows(rows)[0] : null
}

// POST /api/hospitals: the DB enforces coordinate ranges, status values and the region FK.
router.post('/', async (req, res, next) => {
  try {
    checkShape(req.body, SPEC)
    const { cols, vals } = pick(req.body, COLUMNS)
    const hospital = await withTx(req.session.userId, async (client) => {
      const ins = await client.query(
        `INSERT INTO hospital (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING hospital_id`,
        vals,
      )
      return loadHospital(client, ins.rows[0].hospital_id)
    })
    res.status(201).json(hospital)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id: any subset; suspend with {status:'SUSPENDED'}. No DELETE.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = paramId(req.params.id)
    const notFound = new ApiError(404, 'HOSPITAL_NOT_FOUND', `Hospital ${req.params.id} not found`)
    if (id === null) throw notFound
    checkShape(req.body, SPEC)
    const { cols, vals } = pick(req.body, COLUMNS)
    const hospital = await withTx(req.session.userId, async (client) => {
      if (cols.length) {
        const upd = await client.query(
          `UPDATE hospital SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE hospital_id = $1`,
          [id, ...vals],
        )
        if (upd.rowCount === 0) throw notFound
      }
      const h = await loadHospital(client, id)
      if (!h) throw notFound
      return h
    })
    res.json(hospital)
  } catch (err) {
    next(err)
  }
})

export default router
