import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Mapa Operativo del Dashboard usando Google Maps JavaScript API (modo oscuro).
 * - La API Key se obtiene del secreto GOOGLE_MAPS_API_KEY de Base44 a través de la
 *   función backend `getMapsConfig` (no se expone en el bundle ni en .env del frontend).
 * - Sin cargas: mapa limpio sin marcadores.
 * - Con cargas: íconos de camión en Origen (ORIG) y Destino (DEST) unidos por la ruta.
 */

const DEFAULT_CENTER = { lat: 27.8, lng: -81.7 };

// Catálogo rápido para no consumir Geocoding en hubs frecuentes
const KNOWN_LOGISTICS_HUBS = {
  'port everglades': { lat: 26.0853, lng: -80.1183 },
  'port of miami': { lat: 25.7781, lng: -80.1791 },
  portmiami: { lat: 25.7781, lng: -80.1791 },
  'fort lauderdale': { lat: 26.1224, lng: -80.1373 },
  'west palm beach': { lat: 26.7153, lng: -80.0534 },
  miami: { lat: 25.7617, lng: -80.1918 },
  tampa: { lat: 27.9506, lng: -82.4572 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  jacksonville: { lat: 30.3322, lng: -81.6557 },
  savannah: { lat: 32.128, lng: -81.1514 },
  atlanta: { lat: 33.749, lng: -84.388 },
  houston: { lat: 29.7604, lng: -95.3698 },
  dallas: { lat: 32.7767, lng: -96.797 },
  medley: { lat: 25.8406, lng: -80.3264 },
  hialeah: { lat: 25.8576, lng: -80.2781 },
  doral: { lat: 25.8195, lng: -80.3553 },
  lakeland: { lat: 28.0395, lng: -81.9498 },
  naples: { lat: 26.142, lng: -81.7948 },
};

// Estilo oscuro acorde al diseño de Trucky
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1530' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0818' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9b8fc4' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2350' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a3a85' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1b33' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

let mapsScriptPromise = null;
const geocodeCache = new Map();

/** Carga el script de Google Maps una sola vez (patrón singleton). */
function loadGoogleMaps(apiKey) {
  if (typeof window !== 'undefined' && window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsScriptPromise) return mapsScriptPromise;
  mapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => {
      mapsScriptPromise = null;
      reject(new Error('No se pudo cargar Google Maps'));
    };
    document.head.appendChild(script);
  });
  return mapsScriptPromise;
}

/** Resuelve coordenadas: catálogo local → Google Geocoder (si está habilitado). */
async function resolveCoords(maps, address) {
  if (!address) return null;
  const lower = String(address).toLowerCase().trim();
  if (geocodeCache.has(lower)) return geocodeCache.get(lower);

  for (const [key, coords] of Object.entries(KNOWN_LOGISTICS_HUBS)) {
    if (lower.includes(key)) {
      geocodeCache.set(lower, coords);
      return coords;
    }
  }

  try {
    const geocoder = new maps.Geocoder();
    const { results } = await geocoder.geocode({ address });
    if (results?.[0]) {
      const loc = results[0].geometry.location;
      const coords = { lat: loc.lat(), lng: loc.lng() };
      geocodeCache.set(lower, coords);
      return coords;
    }
  } catch (_) {
    // Geocoding API no habilitada o dirección no encontrada: se omite el marcador
  }
  return null;
}

function truckIconSvg(bgColor) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <rect x="1" y="1" width="34" height="34" rx="11" fill="${bgColor}" stroke="#ffffff" stroke-width="2"/>
      <g transform="translate(9,9)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 13V4.5A1.5 1.5 0 0 0 9.5 3h-6A1.5 1.5 0 0 0 2 4.5V12.5a.75.75 0 0 0 .75.75h1.5"/>
        <path d="M11.25 13.5H6.75"/>
        <path d="M14.25 13.5h1.5a.75.75 0 0 0 .75-.75v-2.7a.75.75 0 0 0-.16-.47l-2.6-3.26A.75.75 0 0 0 13.14 6H10.5"/>
        <circle cx="12.75" cy="13.5" r="1.5"/>
        <circle cx="5.25" cy="13.5" r="1.5"/>
      </g>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function DashboardGoogleMap({ loads = [], trucks = [], locale = 'es' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const [selectedRouteInfo, setSelectedRouteInfo] = useState(null);
  const [mapError, setMapError] = useState(null);

  const isEs = locale !== 'en';
  const activeLoads = loads.slice(0, 8);
  const inTransitCount = loads.filter((l) => l.estado === 'en_transito').length;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Obtener la key desde el secreto GOOGLE_MAPS_API_KEY de Base44
        const res = await base44.functions.invoke('getMapsConfig', {});
        const apiKey = res?.data?.apiKey;
        if (!apiKey) throw new Error(res?.data?.error || 'GOOGLE_MAPS_API_KEY no disponible');

        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: DEFAULT_CENTER,
            zoom: 6,
            styles: DARK_MAP_STYLE,
            disableDefaultUI: true,
            zoomControl: true,
            backgroundColor: '#0d0818',
          });
        }
        const map = mapRef.current;

        // Limpiar marcadores/rutas previas
        overlaysRef.current.forEach((o) => o.setMap(null));
        overlaysRef.current = [];

        if (activeLoads.length === 0) {
          map.setCenter(DEFAULT_CENTER);
          map.setZoom(6);
          return;
        }

        const bounds = new maps.LatLngBounds();
        let pointCount = 0;

        for (const load of activeLoads) {
          const [oPos, dPos] = await Promise.all([
            resolveCoords(maps, load.origen),
            resolveCoords(maps, load.destino),
          ]);
          if (cancelled) return;

          const isTransit = load.estado === 'en_transito';

          if (oPos) {
            const m = new maps.Marker({
              position: oPos,
              map,
              icon: { url: truckIconSvg('#5B2BA0'), scaledSize: new maps.Size(34, 34), anchor: new maps.Point(17, 17) },
              title: `${isEs ? 'Origen' : 'Origin'}: ${load.origen}`,
            });
            m.addListener('click', () => setSelectedRouteInfo(load));
            overlaysRef.current.push(m);
            bounds.extend(oPos);
            pointCount++;
          }

          if (dPos) {
            const m = new maps.Marker({
              position: dPos,
              map,
              icon: {
                url: truckIconSvg(isTransit ? '#10b981' : '#7c3aed'),
                scaledSize: new maps.Size(34, 34),
                anchor: new maps.Point(17, 17),
              },
              title: `${isEs ? 'Destino' : 'Destination'}: ${load.destino}`,
            });
            m.addListener('click', () => setSelectedRouteInfo(load));
            overlaysRef.current.push(m);
            bounds.extend(dPos);
            pointCount++;
          }

          if (oPos && dPos) {
            const line = new maps.Polyline({
              path: [oPos, dPos],
              map,
              strokeColor: isTransit ? '#10b981' : '#a855f7',
              strokeOpacity: isTransit ? 0.9 : 0,
              strokeWeight: 3,
              // Línea punteada para cargas pendientes
              icons: isTransit
                ? []
                : [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: '#a855f7', scale: 3 }, offset: '0', repeat: '12px' }],
            });
            line.addListener('click', () => setSelectedRouteInfo(load));
            overlaysRef.current.push(line);
          }
        }

        if (pointCount > 1) {
          map.fitBounds(bounds, 45);
        } else if (pointCount === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(8);
        }
        setMapError(null);
      } catch (err) {
        console.warn('[DashboardGoogleMap] Error cargando Google Maps:', err);
        if (!cancelled) setMapError(err?.message || 'Error');
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [loads, isEs]);

  const handleRecenter = () => {
    setSelectedRouteInfo(null);
    if (mapRef.current) {
      mapRef.current.setCenter(DEFAULT_CENTER);
      mapRef.current.setZoom(6);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="glass-panel rounded-2xl p-5 relative overflow-hidden w-full min-w-0"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#5B2BA0] border border-white/20 shadow-md shadow-[#5B2BA0]/35 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              {isEs ? 'Mapa Operativo de Rutas y Flota' : 'Fleet & Routes Map'}
            </h2>
            <p className="text-xs text-white/60 truncate">
              {isEs
                ? `${activeLoads.length} rutas activas mapeadas · ${inTransitCount} en tránsito · ${trucks.length} camiones registrados`
                : `${activeLoads.length} active routes mapped · ${inTransitCount} in transit · ${trucks.length} registered trucks`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRecenter}
          className="self-start sm:self-auto px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white border border-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <Compass className="w-3.5 h-3.5 text-violet-300" />
          <span>{isEs ? 'Centrar' : 'Center'}</span>
        </button>
      </div>

      <div className="relative w-full h-[340px] rounded-2xl overflow-hidden border border-white/15 bg-[#0d0818] shadow-inner">
        <div ref={containerRef} className="absolute inset-0 w-full h-full z-0" />

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60 px-6 text-center">
            {isEs ? 'No se pudo cargar Google Maps: ' : 'Could not load Google Maps: '}
            {mapError}
          </div>
        )}

        {selectedRouteInfo && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm glass-panel rounded-xl p-3 border border-white/20 text-xs text-white shadow-xl z-[400]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-bold text-violet-300 flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5" />
                {selectedRouteInfo.origen} → {selectedRouteInfo.destino}
              </span>
              <button type="button" onClick={() => setSelectedRouteInfo(null)} className="text-white/60 hover:text-white text-[11px] px-1">
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
