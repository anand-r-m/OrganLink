// Shared organ queries (donor drawer, organs routes).
// OrganSummary: v_organ plus names, the open-offer indicator and the transport status (API_CONTRACT "Organ").
export const organSql = (where, orderBy = '', extraSelect = '') => `
  SELECT v.organ_id AS id, v.donor_id, d.name AS donor_name, bg.group_name AS donor_blood_group,
         v.organ_type_id, v.organ_type_name AS organ_type,
         v.recovering_hospital_id, h.name AS recovering_hospital_name, r.region_code,
         v.recovered_at, v.max_viability_hours, v.expires_at, v.hours_remaining, v.is_expired,
         v.status, v.discard_reason_id, dr.code AS discard_reason_code,
         (ao.offer_id IS NOT NULL) AS has_active_offer, ao.offer_id AS active_offer_id,
         tr.status AS transport_status${extraSelect}
  FROM v_organ v
  JOIN donor d ON d.donor_id = v.donor_id
  JOIN blood_group bg ON bg.blood_group_id = d.blood_group_id
  JOIN hospital h ON h.hospital_id = v.recovering_hospital_id
  JOIN region r ON r.region_id = h.region_id
  LEFT JOIN discard_reason dr ON dr.discard_reason_id = v.discard_reason_id
  LEFT JOIN transport_record tr ON tr.organ_id = v.organ_id
  LEFT JOIN LATERAL (
    SELECT f.offer_id FROM organ_offer f
    WHERE f.organ_id = v.organ_id AND f.status IN ('CREATED','SENT')
    ORDER BY f.offer_id DESC LIMIT 1
  ) ao ON TRUE
  WHERE ${where} ${orderBy}`

export const ORGAN_SUMMARY_SQL = organSql('v.donor_id = $1', 'ORDER BY v.organ_id')

// Organ (with the region's default match weights) by organ id; used for the POST response.
export const ORGAN_WITH_WEIGHTS_SQL = organSql(
  'v.organ_id = $1',
  '',
  `,
         r.hla_weight, r.urgency_weight, r.distance_weight, r.wait_weight`,
)
