// Recipients can be waitlisted for several organ types, so the drawer shows one entry per
// (recipient, organ type). v_waitlist_scored supplies the scores; the names are joined here.
// The view's internal urgency_weight/wait_weight are deliberately not selected: the contract's
// WaitlistEntry shape exposes only the two score components (08 §7).
export const WAITLIST_ENTRY_SQL = `
  SELECT v.recipient_id, r.name AS recipient_name, bg.group_name AS blood_group,
         v.hospital_id, h.name AS hospital_name, v.region_id,
         v.organ_type_id, ot.name AS organ_type,
         v.urgency_id, v.urgency_code,
         to_char(v.listed_date, 'YYYY-MM-DD') AS listed_date,
         v.status, v.wait_months, v.urgency_score, v.wait_score, v.priority_score
  FROM v_waitlist_scored v
  JOIN recipient r ON r.recipient_id = v.recipient_id
  JOIN blood_group bg ON bg.blood_group_id = r.blood_group_id
  JOIN hospital h ON h.hospital_id = v.hospital_id
  JOIN organ_type ot ON ot.organ_type_id = v.organ_type_id`
