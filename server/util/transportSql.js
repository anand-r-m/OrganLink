// Shared transport query (API_CONTRACT "Transport"). The countdown fields come from the organ's
// viability window (v_organ), not a separate clock (06 Stage 6).
import { toCamel } from './case.js'

export const transportSql = (where, orderBy = '') => `
  SELECT t.transport_id AS id, t.organ_id, v.organ_type_name AS organ_type, f.offer_id,
         f.recipient_id, rc.name AS recipient_name,
         t.origin_hospital_id, oh.name AS origin_name, oh.latitude AS origin_lat, oh.longitude AS origin_lng,
         t.destination_hospital_id, dh.name AS dest_name, dh.latitude AS dest_lat, dh.longitude AS dest_lng,
         t.status, t.departed_at, t.arrived_at,
         v.expires_at AS organ_expires_at, v.hours_remaining AS organ_hours_remaining,
         v.max_viability_hours
  FROM transport_record t
  JOIN v_organ v ON v.organ_id = t.organ_id
  JOIN hospital oh ON oh.hospital_id = t.origin_hospital_id
  JOIN hospital dh ON dh.hospital_id = t.destination_hospital_id
  LEFT JOIN LATERAL (
    SELECT o.offer_id, o.recipient_id FROM organ_offer o
    WHERE o.organ_id = t.organ_id AND o.status = 'ACCEPTED'
    ORDER BY o.offer_id DESC LIMIT 1
  ) f ON TRUE
  LEFT JOIN recipient rc ON rc.recipient_id = f.recipient_id
  WHERE ${where} ${orderBy}`

export function adaptTransportRow(row) {
  const r = toCamel(row)
  return {
    id: r.id,
    organId: r.organId,
    organType: r.organType,
    offerId: r.offerId,
    recipientId: r.recipientId,
    recipientName: r.recipientName,
    origin: { id: r.originHospitalId, name: r.originName, latitude: r.originLat, longitude: r.originLng },
    destination: { id: r.destinationHospitalId, name: r.destName, latitude: r.destLat, longitude: r.destLng },
    status: r.status,
    departedAt: r.departedAt,
    arrivedAt: r.arrivedAt,
    organExpiresAt: r.organExpiresAt,
    organHoursRemaining: r.organHoursRemaining,
    // Additive to the contract example: lets the UI size the countdown bar.
    maxViabilityHours: r.maxViabilityHours,
  }
}

export async function loadTransport(client, id) {
  const { rows } = await client.query(transportSql('t.transport_id = $1'), [id])
  return rows.length ? adaptTransportRow(rows[0]) : null
}
