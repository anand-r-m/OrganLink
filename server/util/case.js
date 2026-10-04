// snake_case -> camelCase mapping for DB rows (API_CONTRACT: JSON keys are camelCase).
export function toCamelKey(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// Maps top-level keys only. Row values (incl. Dates, JSON columns) are left untouched.
export function toCamel(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row
  const out = {}
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v
  return out
}

export function toCamelRows(rows) {
  return rows.map(toCamel)
}
