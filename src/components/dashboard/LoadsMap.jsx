import { Fragment } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocode } from '@/lib/floridaLocations';

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

export default function LoadsMap({ loads = [] }) {
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

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Mapa de Rutas</h2>
          <p className="text-xs text-muted-foreground">
            {hasRoutes
              ? `${routes.length} cargas geolocalizadas · origen → destino`
              : 'Sin cargas con ubicaciones reconocidas aún'}
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
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Origen</div>
                    <div style={{ opacity: 0.8 }}>{load.origen}</div>
                    {load.broker_nombre && <div style={{ fontSize: 11, marginTop: 4 }}>Broker: {load.broker_nombre}</div>}
                  </div>
                </Popup>
              </Marker>
              <Marker position={[dest.lat, dest.lng]} icon={pinIcon(color)}>
                <Popup>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Destino</div>
                    <div style={{ opacity: 0.8 }}>{load.destino}</div>
                    {load.tarifa_negociada != null && (
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        Tarifa: ${Number(load.tarifa_negociada).toLocaleString()}
                        {load.millas ? ` · $${(load.tarifa_negociada / load.millas).toFixed(2)}/mi` : ''}
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