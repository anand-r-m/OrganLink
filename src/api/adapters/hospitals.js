import { hospitalId } from '../../utils/displayId.js';

// API Hospital (schema-shaped) -> the row shape the Settings table already uses (mockHospitals).
// traumaLevel is not in the schema (A9), so it is null in live mode.
export function adaptHospital(h) {
  return {
    id: hospitalId(h.id),
    dbId: h.id,
    name: h.name,
    region: h.regionName,
    regionCode: h.regionCode,
    traumaLevel: null,
    status: String(h.status).toLowerCase(),
    lat: h.latitude,
    lng: h.longitude,
    address: h.address ?? '',
    phone: h.phone ?? '',
  };
}

export const adaptHospitals = (rows) => rows.map(adaptHospital);
