import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptRecipient, adaptRecipients, adaptMockRecipient, filterRecipients } from './adapters/recipients.js';
import { mockRecipients } from '../data/mockRecipients.js';

// Mock mode returns mockRecipients; live mode calls GET /api/recipients with the filters as query
// parameters (organ = organ type id). `live` is a parameter only so tests can exercise both branches.
export async function listRecipients(params, live = USE_LIVE_API) {
  if (!live) return filterRecipients(mockRecipients.map(adaptMockRecipient), params);
  return adaptRecipients(await apiFetch('/recipients', { params }));
}

// GET /api/recipients/:id (recipient + HLA + every waitlist entry). `recipient` is an adapted row.
export async function getRecipient(recipient, live = USE_LIVE_API) {
  if (!live) return recipient;
  return adaptRecipient(await apiFetch(`/recipients/${recipient.dbId}`));
}

// POST /api/recipients (body from formToRecipientBody, with optional waitlist). Live mode only.
export async function createRecipient(body, live = USE_LIVE_API) {
  if (!live) throw new Error('Registering recipients through the API needs live mode');
  return adaptRecipient(await apiFetch('/recipients', { method: 'POST', body }));
}

// PATCH /api/recipients/:id: any subset except waitlist; hlaAlleleIds replaces the HLA set.
export async function updateRecipient(recipient, body, live = USE_LIVE_API) {
  if (!live) throw new Error('Updating recipients through the API needs live mode');
  return adaptRecipient(await apiFetch(`/recipients/${recipient.dbId}`, { method: 'PATCH', body }));
}
