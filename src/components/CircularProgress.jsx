import { useId } from 'react';

const SIZE = 64;
const STROKE_WIDTH = 4;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clampValue(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.min(100, Math.max(0, num));
}

export default function CircularProgress({ value, label }) {
  const gradientId = `circular-progress-${useId().replace(/:/g, '')}`;
  const clamped = clampValue(value);
  const displayValue = Math.round(clamped);
  const dashOffset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <figure
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
      aria-label={`${label}: ${displayValue}%`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-success)" />
          </linearGradient>
        </defs>

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--shadow-dark)"
          strokeOpacity={0.15}
          strokeWidth={STROKE_WIDTH}
        />

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />

        <text
          x={CENTER}
          y={CENTER}
          textAnchor="middle"
          dominantBaseline="central"
          className="mono"
          style={{ fontSize: 16, fontWeight: 700 }}
        >
          {displayValue}%
        </text>
      </svg>

      <figcaption
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        {label}
      </figcaption>
    </figure>
  );
}
