import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptWaitlistRows, mockWaitlistRows, filterWaitlistRows } from './adapters/waitlist.js';
import { mockRecipients } from '../data/mockRecipients.js';
import { adaptMockRecipient } from './adapters/recipients.js';

// GET /api/waitlist (sorted by priority score, descending). Params: organ (organTypeId),
// bloodGroup (name), urgency (code), status (entry status). Mock mode flattens the mock
// recipients and filters in memory; the page itself flattens its session list instead.
export async function listWaitlist(params, live = USE_LIVE_API) {
  if (!live) {
    const rows = mockWaitlistRows(mockRecipients.map(adaptMockRecipient));
    return filterWaitlistRows(rows, params).sort((a, b) => b.priorityScore - a.priorityScore);
  }
  return adaptWaitlistRows(await apiFetch('/waitlist', { params }));
}

// POST /api/waitlist. Live mode only: body is { recipientId, organTypeId, urgencyId, listedDate? }.
export async function addWaitlistEntry(body, live = USE_LIVE_API) {
  if (!live) throw new Error('Adding waitlist entries through the API needs live mode');
  return apiFetch('/waitlist', { method: 'POST', body });
}

// PATCH /api/waitlist/:recipientId/:organTypeId. Live mode only: any of urgencyId, status, listedDate.
export async function updateWaitlistEntry(recipientId, organTypeId, body, live = USE_LIVE_API) {
  if (!live) throw new Error('Updating waitlist entries through the API needs live mode');
  return apiFetch(`/waitlist/${recipientId}/${organTypeId}`, { method: 'PATCH', body });
}
