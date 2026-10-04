import { Router } from 'express'
import { withTx } from '../db.js'
import { ApiError } from '../errors.js'
import { toCamel } from '../util/case.js'

const router = Router()

const OUTCOMES = ['SUCCESS', 'FAILED', 'ORGAN_NOT_USED']
const isId = (v) => Number.isSafeInteger(v) && v > 0
const invalid = (message, field) => new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] })

// POST /api/transplants (API_CONTRACT endpoint #32). The DB owns the rules: trg_transplant_requires_delivery
// (offer ACCEPTED, transport DELIVERED -> 422 RULE_VIOLATION), the UNIQUE offer_id (409) and the
// trg_transplant_recorded cascade (organ and this organ type's waitlist entry). No viability check (OL-DEC-02, A).
router.post('/', async (req, res, next) => {
  try {
    const { offerId, outcome, transplantAt, hospitalId, notes } = req.body ?? {}
    if (!isId(offerId)) throw invalid('offerId must be a positive integer', 'offerId')
    if (!OUTCOMES.includes(outcome)) throw invalid(`outcome must be one of ${OUTCOMES.join(', ')}`, 'outcome')
    if (transplantAt != null && (typeof transplantAt !== 'string' || Number.isNaN(Date.parse(transplantAt)))) {
      throw invalid('transplantAt must be an ISO 8601 timestamp', 'transplantAt')
    }
    if (hospitalId != null && !isId(hospitalId)) throw invalid('hospitalId must be a positive integer', 'hospitalId')
    if (notes != null && typeof notes !== 'string') throw invalid('notes must be a string', 'notes')

    const transplant = await withTx(
      req.session.userId,
      async (client) => {
        const offer = await client.query(
          `SELECT f.organ_id, r.hospital_id AS recipient_hospital_id
           FROM organ_offer f JOIN recipient r ON r.recipient_id = f.recipient_id WHERE f.offer_id = $1`,
          [offerId],
        )
        if (offer.rowCount === 0) throw new ApiError(404, 'OFFER_NOT_FOUND', `Offer ${offerId} not found`)
        const { organ_id: organId, recipient_hospital_id: recipientHospital } = offer.rows[0]
        // Serialise with the offer and transport transitions, which lock the organ first.
        await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [organId])
        // A3: the performing hospital defaults to the transport destination. Without a transport the
        // trigger rejects the insert anyway; the recipient's hospital only keeps NOT NULL satisfied until then.
        const dest = await client.query('SELECT destination_hospital_id FROM transport_record WHERE organ_id = $1', [organId])
        const hospital = hospitalId ?? dest.rows[0]?.destination_hospital_id ?? recipientHospital
        const ins = await client.query(
          `INSERT INTO transplant_event (offer_id, hospital_id, transplant_at, outcome, notes)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5) RETURNING transplant_id`,
          [offerId, hospital, transplantAt ?? null, outcome, notes?.trim() || null],
        )
        const { rows } = await client.query(
          `SELECT te.transplant_id AS id, te.offer_id, te.hospital_id, h.name AS hospital_name,
                  te.transplant_at, te.outcome, te.notes
           FROM transplant_event te JOIN hospital h ON h.hospital_id = te.hospital_id
           WHERE te.transplant_id = $1`,
          [ins.rows[0].transplant_id],
        )
        return toCamel(rows[0])
      },
      { sweep: true },
    )
    res.status(201).json(transplant)
  } catch (err) {
    next(err)
  }
})

export default router
