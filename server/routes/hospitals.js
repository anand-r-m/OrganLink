import { Router } from 'express'
import { query } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()

export const HOSPITAL_SQL = `
  SELECT h.hospital_id AS id, h.name, h.address, h.phone, h.latitude, h.longitude,
         h.region_id, r.region_code, r.region_name, h.status
  FROM hospital h JOIN region r USING (region_id)`

// GET /api/hospitals?regionId=&status= (API_CONTRACT endpoint #42). POST/PATCH arrive in OL-024.
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

export default router
