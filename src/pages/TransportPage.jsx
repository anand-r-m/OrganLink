import TransportMap from '../components/TransportMap.jsx';

export default function TransportPage() {
  return (
    <div
      className="transport-page"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)', minWidth: 0 }}
      aria-label="Transport"
    >
      <TransportMap />
    </div>
  );
}
