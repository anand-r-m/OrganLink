/* Metric card — ui_mastercontext.md Section 4.1 */

const ACCENT_COLORS = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
};

export default function StatCard({
  icon: Icon,
  value,
  label,
  trend = null,
  trendLabel,
  color = 'primary',
  className = '',
}) {
  const accent = ACCENT_COLORS[color] ?? ACCENT_COLORS.primary;
  const hasTrend = trend !== null && trend !== undefined;
  const isUp = hasTrend && Number(trend) >= 0;
  const trendText = trendLabel ?? (hasTrend ? String(Math.abs(Number(trend))) : '');

  return (
    <article
      className={`stat-card neu-raised neu-hover-lift ${className}`.trim()}
      aria-label={`${label}: ${value}`}
    >
      <div className="stat-card__top">
        {Icon ? (
          <span className="stat-card__icon" style={{ color: accent }}>
            <Icon size={20} stroke={1.8} aria-hidden="true" />
          </span>
        ) : null}

        {hasTrend || trendLabel ? (
          <span
            className={`stat-card__trend ${isUp ? 'stat-card__trend--up' : 'stat-card__trend--down'}`}
            aria-label={`Trend ${isUp ? 'up' : 'down'} ${trendText}`}
          >
            <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>
            {trendText}
          </span>
        ) : null}
      </div>

      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </article>
  );
}
