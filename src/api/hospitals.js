import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptHospitals } from './adapters/hospitals.js';
import { mockHospitals } from '../data/mockHospitals.js';

// Mock mode returns mockHospitals; live mode calls GET /api/hospitals (05 §7).
// `live` is a parameter only so tests can exercise both branches.
export async function listHospitals(params, live = USE_LIVE_API) {
  if (!live) return mockHospitals;
  return adaptHospitals(await apiFetch('/hospitals', { params }));
}
