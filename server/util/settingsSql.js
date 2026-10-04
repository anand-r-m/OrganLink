import { ApiError } from '../errors.js'

// OrganType shape (API_CONTRACT). Shared by GET /api/lookups and /api/organ-types.
export const ORGAN_TYPE_SQL = `
  SELECT organ_type_id AS id, name, max_viability_hours, response_window_hours,
         priority_weight, min_weight_ratio, max_weight_ratio
  FROM organ_type`

// Region shape: weights are flattened by the route; hospital_count is derived.
export const REGION_SQL = `
  SELECT r.region_id AS id, r.region_code AS code, r.region_name AS name,
         r.hla_weight, r.urgency_weight, r.distance_weight, r.wait_weight,
         (SELECT count(*) FROM hospital h WHERE h.region_id = r.region_id) AS hospital_count
  FROM region r`

export const paramId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null)

// Shape checks only (types); the DB owns every value rule. spec: field -> 'string' | 'number' | 'string?' (nullable).
export function checkShape(body, spec) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object', {})
  }
  for (const [field, kind] of Object.entries(spec)) {
    const v = body[field]
    if (v === undefined) continue
    const nullable = kind.endsWith('?')
    const base = kind.replace('?', '')
    if (v === null && nullable) continue
    const ok = base === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === base
    if (!ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a ${base}`, { fields: [field] })
    }
  }
}

// Builds INSERT column/param lists from a body + {field: column} map, skipping undefined fields.
export function pick(body, columns) {
  const fields = Object.keys(columns).filter((f) => body[f] !== undefined)
  return { fields, cols: fields.map((f) => columns[f]), vals: fields.map((f) => body[f]) }
}
