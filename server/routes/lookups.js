import { Router } from 'express'
import { query } from '../db.js'

const router = Router()

// GET /api/lookups: read-only reference lists for dropdowns (API_CONTRACT endpoint #5, Proposed, A5).
router.get('/', async (_req, res, next) => {
  try {
    const [
      bloodGroups,
      urgencies,
      declineReasons,
      discardReasons,
      exclusionReasons,
      organTypes,
      hlaAlleles,
    ] = await Promise.all([
      query('SELECT blood_group_id AS id, group_name AS name FROM blood_group ORDER BY blood_group_id'),
      query('SELECT urgency_id AS id, code, description, score_value FROM urgency ORDER BY urgency_id'),
      query('SELECT decline_reason_id AS id, code, description FROM decline_reason ORDER BY decline_reason_id'),
      query('SELECT discard_reason_id AS id, code, description FROM discard_reason ORDER BY discard_reason_id'),
      query(
        'SELECT exclusion_reason_id AS id, code, description FROM exclusion_reason ORDER BY exclusion_reason_id',
      ),
      query(`SELECT organ_type_id AS id, name, max_viability_hours, response_window_hours,
                    priority_weight, min_weight_ratio, max_weight_ratio
             FROM organ_type ORDER BY organ_type_id`),
      query('SELECT allele_id AS id, locus, allele_name FROM hla_allele ORDER BY allele_id'),
    ])
    res.json({
      bloodGroups,
      urgencies,
      declineReasons,
      discardReasons,
      exclusionReasons,
      organTypes,
      hlaAlleles,
    })
  } catch (err) {
    next(err)
  }
})

export default router
