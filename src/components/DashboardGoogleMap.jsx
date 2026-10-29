import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation, Compass } from 'lucide-react';

/**
 * Componente de Mapa Interactivo en Modo Oscuro para el Dashboard de Trucky.
 * - Contenido estrictamente dentro de su caja (w-full max-w-full overflow-hidden) para no empujar nunca el layout.
 * - Usa teselas oficiales de OpenStreetMap estilizadas en Modo Oscuro sin requerir API Key ni mostrar marcas de agua.
 */

const KNOWN_LOGISTICS_HUBS = {
  miami: { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  'port of miami': { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  portmiami: { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  'port everglades': { lat: 26.0853, lng: -80.1183, label: 'Port Everglades, FL' },
  'fort lauderdale': { lat: 26.1224, lng: -80.1373, label: 'Fort Lauderdale, FL' },
  lauderdale: { lat: 26.1224, lng: -80.1373, label: 'Fort Lauderdale, FL' },
  tampa: { lat: 27.9506, lng: -82.4572, label: 'Port Tampa Bay, FL' },
  orlando: { lat: 28.5383, lng: -81.3792, label: 'Orlando, FL' },
  jacksonville: { lat: 30.3322, lng: -81.6557, label: 'JAXPORT, Jacksonville, FL' },
  savannah: { lat: 32.128, lng: -81.1514, label: 'Garden City Terminal, Savannah, GA' },
  atlanta: { lat: 33.749, lng: -84.388, label: 'Atlanta, GA' },
  houston: { lat: 29.7604, lng: -95.3698, label: 'Port Houston, TX' },
  dallas: { lat: 32.7767, lng: -96.797, label: 'Dallas, TX' },
  venice: { lat: 27.0998, lng: -82.4543, label: 'Venice, FL' },
  medley: { lat: 25.8406, lng: -80.3264, label: 'Medley, FL' },
  bartow: { lat: 27.8964, lng: -81.8431, label: 'Bartow, FL' },
  hialeah: { lat: 25.8576, lng: -80.2781, label: 'Hialeah, FL' },
  doral: { lat: 25.8195, lng: -80.3553, label: 'Doral, FL' },
  pompano: { lat: 26.2379, lng: -80.1248, label: 'Pompano Beach, FL' },
  lakeland: { lat: 28.0395, lng: -81.9498, label: 'Lakeland, FL' },
  charleston: { lat: 32.7765, lng: -79.9311, label: 'Charleston Port, SC' },
  mobile: { lat: 30.6954, lng: -88.0399, label: 'Port of Mobile, AL' },
  neworleans: { lat: 29.9511, lng: -90.0715, label: 'Port of New Orleans, LA' },
};

const DEFAULT_HUBS_DISPLAY = [
  { name: 'PortMiami, FL', lat: 25.7781, lng: -80.1791, role: 'Port Hub' },
  { name: 'Port Everglades, FL', lat: 26.0853, lng: -80.1183, role: 'Port Hub' },
  { name: 'Port Tampa Bay, FL', lat: 27.9506, lng: -82.4572, role: 'Port Hub' },
  { name: 'Orlando Logistics Center, FL', lat: 28.5383, lng: -81.3792, role: 'Distribution Hub' },
  { name: 'JAXPORT, Jacksonville, FL', lat: 30.3322, lng: -81.6557, role: 'Port Hub' },
  { name: 'Savannah Port, GA', lat: 32.128, lng: -81.1514, role: 'Port Hub' },
];

function resolveLocalHubCoords(address) {
  if (!address) return null;
  const lower = String(address).toLowerCase().trim();
  for (const [key, coords] of Object.entries(KNOWN_LOGISTICS_HUBS)) {
    if (lower.includes(key)) {
      return coords;
    }
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
    `;
    document.head.appendChild(style);
  }
}

export default function DashboardGoogleMap({ loads = [], trucks = [], locale = 'es' }) {
  const leafletContainerRef = useRef(null);
  const leafletInstanceRef = useRef(null);
  const [selectedRouteInfo, setSelectedRouteInfo] = useState(null);

  const isEs = locale !== 'en';
  const activeLoads = loads.slice(0, 6);
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

        const boundsPoints = [];

        const createPinIcon = (bgColor, label) =>
          L.divIcon({
            className: 'trucky-custom-pin',
            html: `<div style="width:28px;height:28px;border-radius:9999px;background:${bgColor};border:2px solid #ffffff;color:#ffffff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(91,43,160,0.65);">${label}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

        if (activeLoads.length > 0) {
          for (const load of activeLoads) {
            const oPos = resolveLocalHubCoords(load.origen);
            const dPos = resolveLocalHubCoords(load.destino);

            if (oPos) {
              boundsPoints.push([oPos.lat, oPos.lng]);
              const m = L.marker([oPos.lat, oPos.lng], {
                icon: createPinIcon('#5B2BA0', 'O'),
              }).addTo(map);
              m.bindTooltip(`${isEs ? 'Origen' : 'Origin'}: ${load.origen}`, { direction: 'top' });
              m.on('click', () => setSelectedRouteInfo(load));
            }

            if (dPos) {
              boundsPoints.push([dPos.lat, dPos.lng]);
              const isTransit = load.estado === 'en_transito';
              const m = L.marker([dPos.lat, dPos.lng], {
                icon: createPinIcon(isTransit ? '#10b981' : '#8b5cf6', 'D'),
              }).addTo(map);
              m.bindTooltip(`${isEs ? 'Destino' : 'Destination'}: ${load.destino}`, { direction: 'top' });
              m.on('click', () => setSelectedRouteInfo(load));
            }

            if (oPos && dPos) {
              L.polyline(
                [
                  [oPos.lat, oPos.lng],
                  [dPos.lat, dPos.lng],
                ],
                {
                  color: load.estado === 'en_transito' ? '#10b981' : '#a855f7',
                  weight: 3,
                  opacity: 0.85,
                  dashArray: load.estado === 'en_transito' ? undefined : '6, 6',
                }
              ).addTo(map);
            }
          }
        }

        if (boundsPoints.length === 0) {
          for (const hub of DEFAULT_HUBS_DISPLAY) {
            boundsPoints.push([hub.lat, hub.lng]);
            const m = L.marker([hub.lat, hub.lng], {
              icon: createPinIcon('#5B2BA0', 'T'),
            }).addTo(map);
            m.bindTooltip(`${hub.name} (${hub.role})`, { direction: 'top' });
          }
          L.polyline(
            [
              [25.7781, -80.1791],
              [26.0853, -80.1183],
              [28.5383, -81.3792],
              [30.3322, -81.6557],
              [32.128, -81.1514],
            ],
            {
              color: '#8b5cf6',
              weight: 2.5,
              opacity: 0.7,
              dashArray: '6, 6',
            }
          ).addTo(map);
        }

        if (boundsPoints.length > 1) {
          map.fitBounds(boundsPoints, { padding: [35, 35] });
        }

        setTimeout(() => {
          map.invalidateSize({ pan: false });
        }, 180);

        leafletInstanceRef.current = map;
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
  }, [activeLoads, isEs]);

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
                {isEs ? 'Mapa Operativo de Rutas y Flota' : 'Live Fleet & Routes Map'}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-400/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
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
