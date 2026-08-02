import { useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';

import { mockHospitals } from '../data/mockHospitals.js';
import { mockTransports } from '../data/mockTransports.js';
import './TransportMap.css';

const MAP_CENTER = [20.5, 78.9];
const MAP_ZOOM = 5;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function getRouteClassName(status) {
  if (status === 'Delivered') return 'transport-route--delivered';
  if (status === 'Expired') return 'transport-route--expired';
  return 'transport-route--active';
}

function countActiveTransports(hospitalName) {
  return mockTransports.filter(
    (transport) =>
      (transport.originHospital === hospitalName ||
        transport.destHospital === hospitalName) &&
      (transport.status === 'In Transit' || transport.status === 'Preparing'),
  ).length;
}

function hasRouteCoords(transport) {
  return (
    Array.isArray(transport.originCoords) &&
    Array.isArray(transport.destCoords) &&
    transport.originCoords.length === 2 &&
    transport.destCoords.length === 2
  );
}

export default function TransportMap() {
  const routes = useMemo(
    () => mockTransports.filter(hasRouteCoords),
    [],
  );

  return (
    <section className="transport-map-card neu-raised" aria-label="Transport map">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        className="transport-map"
        scrollWheelZoom
      >
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
        {mockHospitals.map((hospital) => (
          <CircleMarker
            key={hospital.id}
            center={[hospital.lat, hospital.lng]}
            radius={8}
            pathOptions={{ className: 'transport-hospital-marker' }}
          >
            <Popup>
              <strong>{hospital.name}</strong>
              <br />
              Active transports: {countActiveTransports(hospital.name)}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </section>
  );
}
