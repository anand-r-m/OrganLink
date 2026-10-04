/* Status pill — ui_mastercontext.md Section 4.3.
   Every badge renders its text label, so status is never colour-only
   (Section 10). */

import { formatStatusLabel, getStatusVariant } from '../utils/status.js';

const VARIANT_CLASSES = {
  success: 'badge-active',
  warning: 'badge-pending',
  danger: 'badge-declined',
  primary: 'badge-completed',
  muted: 'badge-expired',
  info: 'badge-info',
};

export { getStatusVariant, formatStatusLabel };

export default function StatusBadge({ status, variant, label, className = '', ...rest }) {
  const resolved = variant ?? getStatusVariant(status);
  const variantClass = VARIANT_CLASSES[resolved] ?? VARIANT_CLASSES.muted;
  const text = label ?? formatStatusLabel(status);

  return (
    <span className={`badge ${variantClass} ${className}`.trim()} role="status" {...rest}>
      {text}
    </span>
  );
}
