import { organId, transportId } from '../../utils/displayId.js';

// Mock status (Title Case, Section 5.7) -> schema status.
const MOCK_STATUS = { Preparing: 'PENDING', 'In Transit': 'IN_TRANSIT', Delivered: 'DELIVERED', Expired: 'FAILED' };

// API Transport -> Transport page row. Elapsed hours feed ViabilityCountdown; the countdown is the
// organ's own viability window (06 Stage 6), so it is derived from organHoursRemaining.
export function adaptTransport(t) {
  const viabilityHours = t.maxViabilityHours;
  return {
    id: transportId(t.id),
    dbId: t.id,
    organId: organId(t.organId),
    organType: t.organType,
    recipientName: t.recipientName,
    originId: t.origin.id,
    originHospital: t.origin.name,
    originCoords: [t.origin.latitude, t.origin.longitude],
    destId: t.destination.id,
    destHospital: t.destination.name,
    destCoords: [t.destination.latitude, t.destination.longitude],
    status: t.status,
    viabilityHours,
    elapsedHours: Math.max(0, viabilityHours - t.organHoursRemaining),
    expiresAt: t.organExpiresAt,
    departedAt: t.departedAt,
    arrivedAt: t.arrivedAt,
  };
}

export const adaptTransportRows = (rows) => rows.map(adaptTransport);

// Mock transport -> the same row shape. Mock rows have no database ids or arrival time.
export function adaptMockTransport(m) {
  return {
    id: m.id,
    dbId: null,
    organId: m.organId,
    organType: m.organType,
    recipientName: null,
    originId: m.originHospital,
    originHospital: m.originHospital,
    originCoords: m.originCoords,
    destId: m.destHospital,
    destHospital: m.destHospital,
    destCoords: m.destCoords,
    status: MOCK_STATUS[m.status] ?? 'PENDING',
    viabilityHours: m.viabilityHours,
    elapsedHours: m.elapsedHours,
    expiresAt: null,
    departedAt: m.departedAt,
    arrivedAt: m.status === 'Delivered' ? m.departedAt : null,
  };
}

// Distinct origin/destination hospitals of the rows -> map markers.
export function hospitalMarkers(rows) {
  const byKey = new Map();
  const add = (key, name, coords, role, row) => {
    const m = byKey.get(key) ?? { key, name, position: coords, origins: 0, destinations: 0, active: 0 };
    if (role === 'origin') m.origins += 1;
    else m.destinations += 1;
    if (row.status === 'PENDING' || row.status === 'IN_TRANSIT') m.active += 1;
    byKey.set(key, m);
  };
  for (const r of rows) {
    add(r.originId, r.originHospital, r.originCoords, 'origin', r);
    add(r.destId, r.destHospital, r.destCoords, 'destination', r);
  }
  return [...byKey.values()];
}

// Which action a row offers: PENDING -> depart, IN_TRANSIT -> deliver, otherwise none.
export const nextTransportAction = (status) => (status === 'PENDING' ? 'depart' : status === 'IN_TRANSIT' ? 'deliver' : null);

// A PENDING transport whose organ's viability window has elapsed should not be dispatched. UI-only:
// expiring an allocated organ in the database is deferred (OL-DEC-02).
export const viabilityElapsed = (row) => row.viabilityHours != null && row.elapsedHours >= row.viabilityHours;
