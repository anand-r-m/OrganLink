/* Status → colour variant and label. Colours follow 07_design_brief.md §4.
   Keys are normalised (lower case, spaces/underscores unified), so both the
   schema's UPPER_SNAKE values and the mock Title Case values resolve. */

const STATUS_VARIANTS = {
  // green
  accepted: 'success',
  delivered: 'success',
  transplanted: 'success',
  active: 'success',
  available: 'success',
  // amber
  sent: 'warning',
  in_transit: 'warning',
  pending: 'warning',
  '1b': 'warning',
  waiting: 'warning',
  // red
  declined: 'danger',
  failed: 'danger',
  expired: 'danger',
  '1a': 'danger',
  // blue
  created: 'info',
  allocated: 'info',
  2: 'info',
  offered: 'info',
  preparing: 'info',
  // grey
  voided: 'muted',
  cancelled: 'muted',
  discarded: 'muted',
  suspended: 'muted',
  inactive: 'muted',
  // mock-only values kept from the original component
  deceased: 'primary',
  completed: 'primary',
};

const normalise = (status) => String(status).trim().toLowerCase().replace(/[\s_]+/g, '_');

export function getStatusVariant(status) {
  return STATUS_VARIANTS[normalise(status)] ?? 'muted';
}

/* IN_TRANSIT → "In Transit". Mixed-case values and urgency codes (1A, 1B, 2)
   are left unchanged. */
export function formatStatusLabel(status) {
  if (status === null || status === undefined) return '';
  const text = String(status).trim();
  if (/^\d/.test(text)) return text;
  if (text !== text.toUpperCase() && !text.includes('_')) return text;
  return text
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
