// Shared offer reads (offers routes). API_CONTRACT "Offer".
import { toCamel } from './case.js'

// v_offer plus names, run rank, transport and transplant summaries.
export const offerSql = (where, orderBy = '') => `
  SELECT v.offer_id AS id, v.organ_id, ot.name AS organ_type, o.donor_id,
         v.recipient_id, rec.name AS recipient_name, h.name AS recipient_hospital_name,
         v.run_id AS match_run_id, mres.rank, v.status,
         v.created_at, v.sent_at, v.responded_at, v.response_window_hours, v.offer_expires_at,
         v.decline_reason_id, dr.code AS decline_reason_code,
         v.void_reason, v.notes, v.created_by,
         tr.transport_id, tr.status AS transport_status,
         te.transplant_id, te.hospital_id AS transplant_hospital_id, th.name AS transplant_hospital_name,
         te.transplant_at, te.outcome AS transplant_outcome, te.notes AS transplant_notes
  FROM v_offer v
  JOIN organ o ON o.organ_id = v.organ_id
  JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
  JOIN recipient rec ON rec.recipient_id = v.recipient_id
  JOIN hospital h ON h.hospital_id = rec.hospital_id
  LEFT JOIN decline_reason dr ON dr.decline_reason_id = v.decline_reason_id
  LEFT JOIN match_result mres ON mres.run_id = v.run_id AND mres.recipient_id = v.recipient_id
  LEFT JOIN transport_record tr ON tr.organ_id = v.organ_id AND v.status = 'ACCEPTED'
  LEFT JOIN transplant_event te ON te.offer_id = v.offer_id
  LEFT JOIN hospital th ON th.hospital_id = te.hospital_id
  WHERE ${where} ${orderBy}`

export function adaptOfferRow(row) {
  const r = toCamel(row)
  return {
    id: r.id,
    organId: r.organId,
    organType: r.organType,
    donorId: r.donorId,
    recipientId: r.recipientId,
    recipientName: r.recipientName,
    recipientHospitalName: r.recipientHospitalName,
    matchRunId: r.matchRunId,
    rank: r.rank,
    status: r.status,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    respondedAt: r.respondedAt,
    responseWindowHours: r.responseWindowHours,
    offerExpiresAt: r.offerExpiresAt,
    declineReasonId: r.declineReasonId,
    declineReasonCode: r.declineReasonCode,
    voidReason: r.voidReason,
    notes: r.notes,
    createdBy: r.createdBy,
    transport: r.transportId === null ? null : { id: r.transportId, status: r.transportStatus },
    transplant:
      r.transplantId === null
        ? null
        : {
            id: r.transplantId,
            offerId: r.id,
            hospitalId: r.transplantHospitalId,
            hospitalName: r.transplantHospitalName,
            transplantAt: r.transplantAt,
            outcome: r.transplantOutcome,
            notes: r.transplantNotes,
          },
  }
}

// One offer by id through any pg client/pool, or null.
export async function loadOffer(db, id) {
  const { rows } = await db.query(offerSql('v.offer_id = $1'), [id])
  return rows.length === 0 ? null : adaptOfferRow(rows[0])
}
