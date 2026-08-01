/* Status pill — ui_mastercontext.md Section 4.3.
   Every badge renders its text label, so status is never colour-only
   (Section 10). */

const VARIANT_CLASSES = {
  success: 'badge-active',
  warning: 'badge-pending',
  danger: 'badge-declined',
  primary: 'badge-completed',
  muted: 'badge-expired',
  info: 'badge-info',
};

/* Status values named across ui_mastercontext.md Sections 5.3–5.9 and the
   colour mappings in dev_split.md. */
const STATUS_VARIANTS = {
  // Donors
  active: 'success',
  deceased: 'primary',
  inactive: 'muted',
  // Recipients
  waiting: 'warning',
  offered: 'info',
  transplanted: 'success',
  // Offers
  created: 'info',
  sent: 'warning',
  accepted: 'success',
  declined: 'danger',
  expired: 'muted',
  // Transports
  preparing: 'info',
  'in transit': 'warning',
  delivered: 'success',
  // Organs
  available: 'success',
  allocated: 'primary',
  // Hospitals
  suspended: 'danger',
  // Urgency levels
  '1a': 'danger',
  '1b': 'warning',
  2: 'info',
  // Generic
  pending: 'warning',
  completed: 'primary',
};

export function getStatusVariant(status) {
  return STATUS_VARIANTS[String(status).trim().toLowerCase()] ?? 'muted';
}

export default function StatusBadge({ status, variant, label, className = '', ...rest }) {
  const resolved = variant ?? getStatusVariant(status);
  const variantClass = VARIANT_CLASSES[resolved] ?? VARIANT_CLASSES.muted;
  const text = label ?? status;

  return (
    <span className={`badge ${variantClass} ${className}`.trim()} role="status" {...rest}>
      {text}
    </span>
  );
}
