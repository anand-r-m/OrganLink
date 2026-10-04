import { USE_LIVE_API, apiFetch } from './client.js';

let cached = null;

// Reference lists for dropdowns (GET /api/lookups, fetched once per session). Live mode only:
// mock mode has no lookup data and keeps its hardcoded lists, so this resolves to null there.
export async function getLookups(live = USE_LIVE_API) {
  if (!live) return null;
  if (!cached) {
    cached = apiFetch('/lookups').catch((err) => {
      cached = null; // do not cache failures
      throw err;
    });
  }
  return cached;
}

export function resetLookupsCache() {
  cached = null;
}
