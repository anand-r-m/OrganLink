import { useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';

import { hospitalMarkers } from '../api/adapters/transport.js';
import './TransportMap.css';

const MAP_CENTER = [20.5, 78.9];
const MAP_ZOOM = 5;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function getRouteClassName(status) {
  if (status === 'DELIVERED') return 'transport-route--delivered';
  if (status === 'FAILED') return 'transport-route--expired';
  return 'transport-route--active';
}

function hasRouteCoords(transport) {
  return (
    Array.isArray(transport.originCoords) &&
    Array.isArray(transport.destCoords) &&
    transport.originCoords.length === 2 &&
    transport.destCoords.length === 2
  );
}

// Draws one line per transport and a marker for every origin/destination hospital.
export default function TransportMap({ transports = [] }) {
  const routes = useMemo(() => transports.filter(hasRouteCoords), [transports]);
  const markers = useMemo(() => hospitalMarkers(routes), [routes]);

  return (
    <section className="transport-map-card neu-raised" aria-label="Transport map">
      <MapContainer center={MAP_CENTER} zoom={MAP_ZOOM} className="transport-map" scrollWheelZoom>
        <TileLayer url={TILE_URL} />
        {routes.map((transport) => (
          <Polyline
            key={transport.id}
            positions={[transport.originCoords, transport.destCoords]}
            pathOptions={{
              className: `transport-route ${getRouteClassName(transport.status)}`,
              weight: 3,
              opacity: 0.9,
            }}
          />
        ))}
        {markers.map((m) => (
          <CircleMarker
            key={m.key}
            center={m.position}
            radius={8}
            pathOptions={{ className: 'transport-hospital-marker' }}
          >
            <Popup>
              <strong>{m.name}</strong>
              <br />
              Origin of {m.origins} · Destination of {m.destinations}
              <br />
              Active transports: {m.active}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </section>
  );
}
