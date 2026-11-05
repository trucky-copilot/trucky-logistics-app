import { Fragment, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '@/lib/LanguageContext';
import { geocode } from '@/lib/floridaLocations';
import { effectiveRate } from '@/lib/loadRate';

// Colored pin via divIcon (no external image assets needed)
function pinIcon(color) {
  return L.divIcon({
    className: 'trucky-pin',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}66,0 2px 4px rgba(0,0,0,.5)"></span>`,
  });
}

const ROUTE_COLOR = {
  ganancia: '#4ade80',
  break_even: '#facc15',
  perdida: '#f87171',
  pendiente: '#a78bfa',
  en_transito: '#8b5cf6',
  entregado: '#4ade80',
  cancelado: '#f87171',
};

function routeColor(load) {
  if (load.resultado && ROUTE_COLOR[load.resultado]) return ROUTE_COLOR[load.resultado];
  if (load.estado && ROUTE_COLOR[load.estado]) return ROUTE_COLOR[load.estado];
  return '#8b5cf6';
}

// Proveedores de cuadros del mapa: si el primero no carga (bloqueado por la red),
// se pasa al segundo automáticamente.
const TILE_PROVIDERS = [
  {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
  },
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
];

export default function LoadsMap({ loads = [], bare = false }) {
  const { t } = useLanguage();
  const [tileIdx, setTileIdx] = useState(0);
  const tiles = TILE_PROVIDERS[tileIdx];
  const onTileError = () => setTileIdx(i => (i < TILE_PROVIDERS.length - 1 ? i + 1 : i));
  // Build geocoded routes — keep only loads where both ends resolve.
  const routes = loads
    .map((load) => {
      const origin = geocode(load.origen);
      const dest = geocode(load.destino);
      if (!origin || !dest) return null;
      return { load, origin, dest, color: routeColor(load) };
    })
    .filter(Boolean);

  const hasRoutes = routes.length > 0;
  const center = hasRoutes ? routes[0].origin : { lat: 27.66, lng: -81.5 }; // Florida center

  // Solo el mapa, sin tarjeta (respaldo dentro del mapa del Dashboard)
  const mapOnly = (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={hasRoutes ? 7 : 6}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%', background: 'hsl(268 45% 5%)' }}
    >
      <TileLayer
        key={tiles.url}
        attribution={tiles.attribution}
        url={tiles.url}
        eventHandlers={{ tileerror: onTileError }}
      />
      {routes.map(({ load, origin, dest, color }, i) => (
        <Fragment key={load.id || i}>
          <Polyline
            positions={[[origin.lat, origin.lng], [dest.lat, dest.lng]]}
            pathOptions={{ color, weight: 2.5, opacity: 0.85, dashArray: '6 6' }}
          />
          <Marker position={[origin.lat, origin.lng]} icon={pinIcon(color)} />
          <Marker position={[dest.lat, dest.lng]} icon={pinIcon(color)} />
        </Fragment>
      ))}
    </MapContainer>
  );
  if (bare) return mapOnly;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t.map.title}</h2>
          <p className="text-xs text-muted-foreground">
            {hasRoutes
              ? `${routes.length} ${t.map.geolocated}`
              : t.map.empty}
          </p>
        </div>
      </div>

      <div className="relative" style={{ height: 340 }}>
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={hasRoutes ? 7 : 6}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%', background: 'hsl(268 45% 5%)' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {routes.map(({ load, origin, dest, color }, i) => (
            <Fragment key={load.id || i}>
              <Polyline
                positions={[[origin.lat, origin.lng], [dest.lat, dest.lng]]}
                pathOptions={{ color, weight: 2.5, opacity: 0.85, dashArray: '6 6' }}
              />
              <Marker position={[origin.lat, origin.lng]} icon={pinIcon(color)}>
                <Popup>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.map.origin}</div>
                    <div style={{ opacity: 0.8 }}>{load.origen}</div>
                    {load.broker_nombre && <div style={{ fontSize: 11, marginTop: 4 }}>Broker: {load.broker_nombre}</div>}
                  </div>
                </Popup>
              </Marker>
              <Marker position={[dest.lat, dest.lng]} icon={pinIcon(color)}>
                <Popup>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.map.destination}</div>
                    <div style={{ opacity: 0.8 }}>{load.destino}</div>
                    {effectiveRate(load) > 0 && (
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        {t.map.rate}: ${effectiveRate(load).toLocaleString('en-US')}
                        {load.millas ? ` · $${(effectiveRate(load) / load.millas).toFixed(2)}/mi` : ''}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </Fragment>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}