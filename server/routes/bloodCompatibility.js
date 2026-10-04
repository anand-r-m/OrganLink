import { Router } from 'express'
import { query, withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamelRows } from '../util/case.js'

const router = Router()

const PAIR_SQL = `
  SELECT bc.donor_bg_id AS donor_blood_group_id, d.group_name AS donor_group,
         bc.recipient_bg_id AS recipient_blood_group_id, r.group_name AS recipient_group,
         bc.compatible
  FROM blood_compatibility bc
  JOIN blood_group d ON d.blood_group_id = bc.donor_bg_id
  JOIN blood_group r ON r.blood_group_id = bc.recipient_bg_id`

const isId = (v) => Number.isInteger(v) && v > 0

// GET /api/blood-compatibility: the full 8x8 matrix (64 pairs).
router.get('/', async (_req, res, next) => {
  try {
    const [bloodGroups, pairs] = await Promise.all([
      query('SELECT blood_group_id AS id, group_name AS name FROM blood_group ORDER BY blood_group_id'),
      query(`${PAIR_SQL} ORDER BY bc.donor_bg_id, bc.recipient_bg_id`),
    ])
    res.json({ bloodGroups, pairs: toCamelRows(pairs) })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/blood-compatibility: one pair per call.
router.patch('/', async (req, res, next) => {
  try {
    const b = req.body
    const bad = []
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object', {})
    }
    if (!isId(b.donorBloodGroupId)) bad.push('donorBloodGroupId')
    if (!isId(b.recipientBloodGroupId)) bad.push('recipientBloodGroupId')
    if (typeof b.compatible !== 'boolean') bad.push('compatible')
    if (bad.length) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Invalid fields: ${bad.join(', ')}`, { fields: bad })
    }
    const pair = await withTx(req.session.userId, async (client) => {
      const upd = await client.query(
        `UPDATE blood_compatibility SET compatible = $3 WHERE donor_bg_id = $1 AND recipient_bg_id = $2`,
        [b.donorBloodGroupId, b.recipientBloodGroupId, b.compatible],
      )
      if (upd.rowCount === 0) {
        throw new ApiError(404, 'BLOOD_COMPATIBILITY_NOT_FOUND', 'No such blood group pair')
      }
      const { rows } = await client.query(`${PAIR_SQL} WHERE bc.donor_bg_id = $1 AND bc.recipient_bg_id = $2`, [
        b.donorBloodGroupId,
        b.recipientBloodGroupId,
      ])
      return toCamelRows(rows)[0]
    })
    res.json(pair)
  } catch (err) {
    next(err)
  }
})

export default router
