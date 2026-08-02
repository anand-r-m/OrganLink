import { useEffect, useMemo, useState } from 'react';

function toSeconds(hours) {
  const num = Number(hours);
  if (Number.isNaN(num) || num < 0) return 0;
  return num * 3600;
}

function formatRemaining(seconds) {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getBarColor(percentRemaining) {
  if (percentRemaining > 50) return 'var(--color-success)';
  if (percentRemaining >= 20) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export default function ViabilityCountdown({ viabilityHours, elapsedHours }) {
  const totalSeconds = useMemo(() => toSeconds(viabilityHours), [viabilityHours]);
  const initialRemaining = useMemo(
    () => Math.max(0, totalSeconds - toSeconds(elapsedHours)),
    [totalSeconds, elapsedHours],
  );

  const [remainingSeconds, setRemainingSeconds] = useState(initialRemaining);

  useEffect(() => {
    setRemainingSeconds(initialRemaining);

    if (initialRemaining <= 0) return undefined;

    const timerId = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [initialRemaining]);

  const percentRemaining =
    totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0;
  const barColor = getBarColor(percentRemaining);
  const timeLabel = formatRemaining(remainingSeconds);
  const isUrgent = remainingSeconds > 0 && remainingSeconds < 3600;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        className={`neu-inset${isUrgent ? ' pulse-danger' : ''}`}
        style={{
          flex: 1,
          height: 8,
          padding: 2,
          overflow: 'hidden',
        }}
        aria-hidden="true"
      >
        <div
          style={{
            width: `${percentRemaining}%`,
            height: '100%',
            borderRadius: 'inherit',
            backgroundColor: barColor,
            transition: 'width 1s linear, background-color 300ms ease',
          }}
        />
      </div>

      <span
        className="mono"
        aria-live="polite"
        aria-atomic="true"
        style={{ flexShrink: 0 }}
      >
        {timeLabel}
      </span>
    </div>
  );
}
