// Display IDs are generated in the frontend only (A11, U5); the API carries integer keys.
export function formatDisplayId(prefix, id, width = 4) {
  return `${prefix}-${String(id).padStart(width, '0')}`;
}

export const donorId = (id) => formatDisplayId('D', id);
export const recipientId = (id) => formatDisplayId('R', id);
export const organId = (id) => formatDisplayId('O', id);
export const offerId = (id) => formatDisplayId('OF', id);
export const transportId = (id) => formatDisplayId('T', id);
export const matchRunId = (id) => formatDisplayId('MR', id);
// Hospitals keep the 3-digit mock format (HSP-001) so the existing table looks the same.
export const hospitalId = (id) => formatDisplayId('HSP', id, 3);
