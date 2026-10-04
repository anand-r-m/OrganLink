import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptMatchRun } from './adapters/matching.js';
import { mockLatestRun, mockRunById, mockRunMatch } from '../data/mockMatching.js';

// Default weights used when an organ has none (mock mode has no regional policy).
export const MOCK_DEFAULT_WEIGHTS = { hla: 30, urgency: 30, distance: 20, wait: 20 };

// Runs and saves a match (POST /api/matching/runs). `organ` is an adapted organ row; every Re-run
// creates a new run (U8). `live` is a parameter only so tests can exercise both branches.
export async function runMatch(organ, weights, live = USE_LIVE_API) {
  if (!live) return mockRunMatch({ ...organ, id: organ.id }, weights);
  return adaptMatchRun(await apiFetch('/matching/runs', { method: 'POST', body: { organId: organ.dbId, weights } }));
}

export async function getMatchRun(id, live = USE_LIVE_API) {
  if (!live) return mockRunById(id);
  return adaptMatchRun(await apiFetch(`/matching/runs/${id}`));
}

// The newest saved run for an organ, or null when it has never been matched
// (GET /api/organs/:id/runs, then GET /api/matching/runs/:id).
export async function getLatestRun(organ, live = USE_LIVE_API) {
  if (!live) return mockLatestRun(organ.id);
  const runs = await apiFetch(`/organs/${organ.dbId}/runs`);
  return runs.length === 0 ? null : getMatchRun(runs[0].id, live);
}

// The recovering hospital's regional weights for an organ (GET /api/organs/:id).
export async function getDefaultWeights(organ, live = USE_LIVE_API) {
  if (!live) return MOCK_DEFAULT_WEIGHTS;
  return (await apiFetch(`/organs/${organ.dbId}`)).defaultWeights;
}
