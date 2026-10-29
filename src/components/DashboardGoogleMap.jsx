import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass } from 'lucide-react';

/**
 * Componente de Mapa Interactivo en Modo Oscuro para el Dashboard de Trucky.
 * - Si no hay cargas registradas (loads.length === 0), el mapa permanece limpio sin marcadores ni líneas.
 * - Cuando existen cargas, resuelve las coordenadas de origen y destino (catálogo local rápido + fallback Nominatim)
 *   y renderiza íconos de camiones para el Origen y el Destino unidos por la ruta.
 */

const KNOWN_LOGISTICS_HUBS = {
  miami: { lat: 25.7781, lng: -80.1791, label: 'Miami, FL' },
  'port of miami': { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  portmiami: { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  'port everglades': { lat: 26.0853, lng: -80.1183, label: 'Port Everglades, FL' },
  'fort lauderdale': { lat: 26.1224, lng: -80.1373, label: 'Fort Lauderdale, FL' },
  lauderdale: { lat: 26.1224, lng: -80.1373, label: 'Fort Lauderdale, FL' },
  tampa: { lat: 27.9506, lng: -82.4572, label: 'Tampa, FL' },
  orlando: { lat: 28.5383, lng: -81.3792, label: 'Orlando, FL' },
  jacksonville: { lat: 30.3322, lng: -81.6557, label: 'Jacksonville, FL' },
  savannah: { lat: 32.128, lng: -81.1514, label: 'Savannah, GA' },
  atlanta: { lat: 33.749, lng: -84.388, label: 'Atlanta, GA' },
  houston: { lat: 29.7604, lng: -95.3698, label: 'Houston, TX' },
  dallas: { lat: 32.7767, lng: -96.797, label: 'Dallas, TX' },
  venice: { lat: 27.0998, lng: -82.4543, label: 'Venice, FL' },
  medley: { lat: 25.8406, lng: -80.3264, label: 'Medley, FL' },
  bartow: { lat: 27.8964, lng: -81.8431, label: 'Bartow, FL' },
  hialeah: { lat: 25.8576, lng: -80.2781, label: 'Hialeah, FL' },
  doral: { lat: 25.8195, lng: -80.3553, label: 'Doral, FL' },
  pompano: { lat: 26.2379, lng: -80.1248, label: 'Pompano Beach, FL' },
  lakeland: { lat: 28.0395, lng: -81.9498, label: 'Lakeland, FL' },
  naples: { lat: 26.142, lng: -81.7948, label: 'Naples, FL' },
  'west palm beach': { lat: 26.7153, lng: -80.0534, label: 'West Palm Beach, FL' },
  wpb: { lat: 26.7153, lng: -80.0534, label: 'West Palm Beach, FL' },
  'palm beach': { lat: 26.7153, lng: -80.0534, label: 'West Palm Beach, FL' },
  'fort myers': { lat: 26.6406, lng: -81.8723, label: 'Fort Myers, FL' },
  sarasota: { lat: 27.3364, lng: -82.5307, label: 'Sarasota, FL' },
  ocala: { lat: 29.1872, lng: -82.1401, label: 'Ocala, FL' },
  tallahassee: { lat: 30.4383, lng: -84.2807, label: 'Tallahassee, FL' },
  pensacola: { lat: 30.4213, lng: -87.2169, label: 'Pensacola, FL' },
  daytona: { lat: 29.2108, lng: -81.0228, label: 'Daytona Beach, FL' },
  melbourne: { lat: 28.0836, lng: -80.6081, label: 'Melbourne, FL' },
  charleston: { lat: 32.7765, lng: -79.9311, label: 'Charleston, SC' },
  charlotte: { lat: 35.2271, lng: -80.8431, label: 'Charlotte, NC' },
  mobile: { lat: 30.6954, lng: -88.0399, label: 'Mobile, AL' },
  'new orleans': { lat: 29.9511, lng: -90.0715, label: 'New Orleans, LA' },
  neworleans: { lat: 29.9511, lng: -90.0715, label: 'New Orleans, LA' },
  memphis: { lat: 35.1495, lng: -90.049, label: 'Memphis, TN' },
  nashville: { lat: 36.1627, lng: -86.7816, label: 'Nashville, TN' },
  chicago: { lat: 41.8781, lng: -87.6298, label: 'Chicago, IL' },
  laredo: { lat: 27.5036, lng: -99.5076, label: 'Laredo, TX' },
  'san antonio': { lat: 29.4241, lng: -98.4936, label: 'San Antonio, TX' },
  austin: { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
  'los angeles': { lat: 34.0522, lng: -118.2437, label: 'Los Angeles, CA' },
  'long beach': { lat: 33.7701, lng: -118.1937, label: 'Long Beach, CA' },
  newark: { lat: 40.7357, lng: -74.1724, label: 'Newark, NJ' },
  'new york': { lat: 40.7128, lng: -74.006, label: 'New York, NY' },
};

const geocodeRuntimeCache = new Map();

/**
 * Resuelve las coordenadas de una ciudad/dirección primero por catálogo instantáneo
 * y si no está en el catálogo, consulta el geocodificador público de OpenStreetMap (Nominatim).
 */
async function resolveAddressCoords(address) {
  if (!address) return null;
  const lower = String(address).toLowerCase().trim();
  if (!lower) return null;

  if (geocodeRuntimeCache.has(lower)) {
    return geocodeRuntimeCache.get(lower);
  }

  for (const [key, coords] of Object.entries(KNOWN_LOGISTICS_HUBS)) {
    if (lower.includes(key)) {
      geocodeRuntimeCache.set(lower, coords);
      return coords;
    }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en-US,es' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        const resolved = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          label: address,
        };
        geocodeRuntimeCache.set(lower, resolved);
        return resolved;
      }
    }
  } catch (_) {
    // Fallback silencioso si la red bloquea Nominatim
  }

  return null;
}

function ensureLeafletCss() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('trucky-leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'trucky-leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!document.getElementById('trucky-dark-tiles-style')) {
    const style = document.createElement('style');
    style.id = 'trucky-dark-tiles-style';
    style.textContent = `
      .trucky-dark-map-tiles {
        filter: invert(100%) hue-rotate(195deg) brightness(88%) contrast(92%) saturate(135%);
      }
      .leaflet-container {
        background: #0d0818 !important;
        font-family: 'Inter', sans-serif !important;
      }
      .trucky-truck-marker {
        background: transparent !important;
        border: none !important;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Genera el HTML del marcador con ícono de camión (SVG Lucide Truck) y etiqueta opcional.
 * @param {string} bgColor Color de fondo del pin (#5B2BA0 para Origen, #10b981/#8b5cf6 para Destino)
 * @param {string} badgeText Etiqueta corta ('ORIG' o 'DEST')
 */
function buildTruckMarkerHtml(bgColor, badgeText) {
  return `
    <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
      <div style="
        width:34px;
        height:34px;
        border-radius:12px;
        background:${bgColor};
        border:2px solid #ffffff;
        color:#ffffff;
        display:flex;
        align-items:center;
        justify-content:center;
        box-shadow:0 6px 16px rgba(0,0,0,0.65), 0 0 12px ${bgColor}99;
      ">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
          <path d="M15 18H9"/>
          <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
          <circle cx="17" cy="18" r="2"/>
          <circle cx="7" cy="18" r="2"/>
        </svg>
      </div>
      <span style="
        position:absolute;
        bottom:-6px;
        padding:1px 4px;
        border-radius:4px;
        background:#0d0818;
        border:1px solid rgba(255,255,255,0.35);
        color:#ffffff;
        font-size:8px;
        font-weight:800;
        letter-spacing:0.04em;
        line-height:1;
      ">${badgeText}</span>
    </div>
  `;
}

export default function DashboardGoogleMap({ loads = [], trucks = [], locale = 'es' }) {
  const leafletContainerRef = useRef(null);
  const leafletInstanceRef = useRef(null);
  const [selectedRouteInfo, setSelectedRouteInfo] = useState(null);

  const isEs = locale !== 'en';
  const activeLoads = loads.slice(0, 8);
  const inTransitCount = loads.filter((l) => l.estado === 'en_transito').length;

  useEffect(() => {
    if (!leafletContainerRef.current) return;

    let cancelled = false;
    ensureLeafletCss();

    async function initDarkMap() {
      try {
        const L = (await import('leaflet')).default;
        if (cancelled || !leafletContainerRef.current) return;

        if (leafletInstanceRef.current) {
          leafletInstanceRef.current.remove();
          leafletInstanceRef.current = null;
        }

        const map = L.map(leafletContainerRef.current, {
          center: [27.8, -81.7],
          zoom: 6,
          zoomControl: true,
          attributionControl: false,
          keyboard: false,
        });

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          className: 'trucky-dark-map-tiles',
        }).addTo(map);

        leafletInstanceRef.current = map;

        setTimeout(() => {
          if (!cancelled && leafletInstanceRef.current) {
            leafletInstanceRef.current.invalidateSize({ pan: false });
          }
        }, 180);

        // Si NO hay cargas registradas, dejamos el mapa completamente limpio (sin puntos T ni líneas)
        if (activeLoads.length === 0) {
          return;
        }

        const createTruckIcon = (bgColor, badgeText) =>
          L.divIcon({
            className: 'trucky-truck-marker',
            html: buildTruckMarkerHtml(bgColor, badgeText),
            iconSize: [36, 40],
            iconAnchor: [18, 20],
          });

        const boundsPoints = [];

        for (const load of activeLoads) {
          if (cancelled) return;

          const [oPos, dPos] = await Promise.all([
            resolveAddressCoords(load.origen),
            resolveAddressCoords(load.destino),
          ]);

          if (cancelled || !leafletInstanceRef.current) return;

          if (oPos) {
            boundsPoints.push([oPos.lat, oPos.lng]);
            const originMarker = L.marker([oPos.lat, oPos.lng], {
              icon: createTruckIcon('#5B2BA0', isEs ? 'ORIG' : 'ORIG'),
            }).addTo(map);
            originMarker.bindTooltip(
              `🚚 ${isEs ? 'Origen' : 'Origin'}: ${load.origen}`,
              { direction: 'top', offset: [0, -14] }
            );
            originMarker.on('click', () => setSelectedRouteInfo(load));
          }

          if (dPos) {
            boundsPoints.push([dPos.lat, dPos.lng]);
            const isTransit = load.estado === 'en_transito';
            const destMarker = L.marker([dPos.lat, dPos.lng], {
              icon: createTruckIcon(isTransit ? '#10b981' : '#7c3aed', 'DEST'),
            }).addTo(map);
            destMarker.bindTooltip(
              `🚚 ${isEs ? 'Destino' : 'Destination'}: ${load.destino}`,
              { direction: 'top', offset: [0, -14] }
            );
            destMarker.on('click', () => setSelectedRouteInfo(load));
          }

          if (oPos && dPos) {
            const routeLine = L.polyline(
              [
                [oPos.lat, oPos.lng],
                [dPos.lat, dPos.lng],
              ],
              {
                color: load.estado === 'en_transito' ? '#10b981' : '#a855f7',
                weight: 3,
                opacity: 0.9,
                dashArray: load.estado === 'en_transito' ? undefined : '6, 6',
              }
            ).addTo(map);
            routeLine.on('click', () => setSelectedRouteInfo(load));
          }
        }

        if (!cancelled && leafletInstanceRef.current) {
          if (boundsPoints.length > 1) {
            map.fitBounds(boundsPoints, { padding: [45, 45], maxZoom: 10 });
          } else if (boundsPoints.length === 1) {
            map.setView(boundsPoints[0], 8);
          }
        }
      } catch (err) {
        console.warn('[DashboardGoogleMap] Error inicializando mapa oscuro:', err);
      }
    }

    initDarkMap();

    return () => {
      cancelled = true;
      if (leafletInstanceRef.current) {
        leafletInstanceRef.current.remove();
        leafletInstanceRef.current = null;
      }
    };
  }, [loads, isEs]);

  const handleRecenter = () => {
    setSelectedRouteInfo(null);
    if (leafletInstanceRef.current) {
      leafletInstanceRef.current.setView([27.8, -81.7], 6);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="glass-panel rounded-2xl p-5 relative overflow-hidden w-full min-w-0"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      {/* Encabezado del Mapa */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#5B2BA0] border border-white/20 shadow-md shadow-[#5B2BA0]/35 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white truncate">
                {isEs ? 'Mapa Operativo de Rutas y Flota' : 'Fleet & Routes Map'}
              </h2>
            </div>
            <p className="text-xs text-white/60 truncate">
              {isEs
                ? `${activeLoads.length} rutas activas mapeadas · ${inTransitCount} en tránsito · ${trucks.length} camiones registrados`
                : `${activeLoads.length} active routes mapped · ${inTransitCount} in transit · ${trucks.length} registered trucks`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
          <button
            type="button"
            onClick={handleRecenter}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white border border-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5 text-violet-300" />
            <span>{isEs ? 'Centrar' : 'Center'}</span>
          </button>
        </div>
      </div>

      {/* Contenedor del Mapa en Modo Oscuro (340px) */}
      <div className="relative w-full h-[340px] rounded-2xl overflow-hidden border border-white/15 bg-[#0d0818] shadow-inner">
        <div ref={leafletContainerRef} className="absolute inset-0 w-full h-full z-0" />

        {selectedRouteInfo && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm glass-panel rounded-xl p-3 border border-white/20 text-xs text-white shadow-xl z-[400]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-bold text-violet-300 flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5" />
                {selectedRouteInfo.origen} → {selectedRouteInfo.destino}
              </span>
              <button
                type="button"
                onClick={() => setSelectedRouteInfo(null)}
                className="text-white/60 hover:text-white text-[11px] px-1"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center justify-between text-white/75 text-[11px]">
              <span>{selectedRouteInfo.broker_nombre || 'Broker'}</span>
              <span className="font-mono font-semibold text-emerald-400">
                ${(selectedRouteInfo.tarifa_negociada || 0).toLocaleString()} ({selectedRouteInfo.millas || '--'} mi)
              </span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
