import { ApiError, USE_LIVE_API, apiFetch } from './client.js';
import { adaptMockTransport, adaptTransport, adaptTransportRows } from './adapters/transport.js';
import { mockTransports } from '../data/mockTransports.js';

// Mock mode keeps transports in this module so actions are visible. The imported data is never mutated.
let mockRows = mockTransports.map(adaptMockTransport);
export const resetMockTransports = () => {
  mockRows = mockTransports.map(adaptMockTransport);
};

// Mock mirror of the server's conditional update (A2).
function mockTransition(row, required, patch) {
  const current = mockRows.find((r) => r.id === row.id);
  if (!current) throw new ApiError(404, 'TRANSPORT_NOT_FOUND', `Transport ${row.id} not found`);
  if (current.status !== required) {
    throw new ApiError(409, 'INVALID_STATE_TRANSITION', `Transport ${row.id} is ${current.status}; this action requires ${required}`);
  }
  const next = { ...current, ...patch };
  mockRows = mockRows.map((r) => (r.id === row.id ? next : r));
  return next;
}

// GET /api/transport. `status` is one status or a comma-separated list. `live` is a parameter only
// so tests can exercise both branches.
export async function listTransports({ status } = {}, live = USE_LIVE_API) {
  if (!live) {
    const wanted = status ? status.split(',') : null;
    return mockRows.filter((r) => !wanted || wanted.includes(r.status));
  }
  return adaptTransportRows(await apiFetch('/transport', { params: { status } }));
}

// POST /api/transport/:id/depart: PENDING -> IN_TRANSIT (409 INVALID_STATE_TRANSITION otherwise).
export async function departTransport(row, live = USE_LIVE_API) {
  if (!live) return mockTransition(row, 'PENDING', { status: 'IN_TRANSIT', departedAt: new Date().toISOString() });
  return adaptTransport(await apiFetch(`/transport/${row.dbId}/depart`, { method: 'POST' }));
}

// POST /api/transport/:id/deliver: IN_TRANSIT -> DELIVERED.
export async function deliverTransport(row, live = USE_LIVE_API) {
  if (!live) return mockTransition(row, 'IN_TRANSIT', { status: 'DELIVERED', arrivedAt: new Date().toISOString() });
  return adaptTransport(await apiFetch(`/transport/${row.dbId}/deliver`, { method: 'POST' }));
}
