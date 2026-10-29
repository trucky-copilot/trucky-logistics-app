import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation, Layers, Compass } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Componente de Mapa Interactivo en Modo Oscuro para el Dashboard de Trucky.
 * - Obtiene GOOGLE_MAPS_API_KEY desde .env local o desde los secretos de Base44 (vía marketChat / getGoogleMapsConfig).
 * - Si Maps JavaScript API está activa en Google Cloud, renderiza Google Maps en ColorScheme.DARK.
 * - Si en Google Cloud Console la clave solo tiene habilitadas APIs de backend o mientras carga,
 *   renderiza un mapa interactivo en Modo Oscuro usando teselas libres de API Key (OpenStreetMap con filtro oscuro Trucky).
 */

const ENV_GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.GOOGLE_MAPS_API_KEY ||
  '';

let cachedRuntimeApiKey = ENV_GOOGLE_MAPS_API_KEY || '';
let googleMapsLoaderPromise = null;

// Coordenadas de los principales puertos y hubs logísticos de Trucky
const KNOWN_LOGISTICS_HUBS = {
  miami: { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  'port of miami': { lat: 25.7781, lng: -80.1791, label: 'PortMiami, FL' },
  'port everglades': { lat: 26.0853, lng: -80.1183, label: 'Port Everglades, FL' },
  'fort lauderdale': { lat: 26.1224, lng: -80.1373, label: 'Fort Lauderdale, FL' },
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
        filter: invert(100%) hue-rotate(195deg) brightness(88%) contrast(92%) saturate(130%);
      }
      .leaflet-container {
        background: #0d0818 !important;
      }
    `;
    document.head.appendChild(style);
  }
}

function loadGoogleMapsBootstrap(apiKey, locale = 'es') {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google.maps);
  }
  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    ((g) => {
      var h,
        a,
        k,
        p = 'The Google Maps JavaScript API',
        c = 'google',
        l = 'importLibrary',
        q = '__ib__',
        m = document,
        b = window;
      b = b[c] || (b[c] = {});
      var d = b.maps || (b.maps = {}),
        r = new Set(),
        e = new URLSearchParams(),
        u = () =>
          h ||
          (h = new Promise(async (f, n) => {
            await (a = m.createElement('script'));
            e.set('libraries', [...r] + '');
            for (k in g)
              e.set(
                k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()),
                g[k]
              );
            e.set('callback', c + '.maps.' + q);
            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
            d[q] = f;
            a.onerror = () => (h = n(Error(p + ' could not load.')));
            a.nonce = m.querySelector('script[nonce]')?.nonce || '';
            m.head.append(a);
          }));
      d[l]
        ? console.warn(p + ' only loads once. Ignoring:', g)
        : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
    })({
      key: apiKey,
      v: 'weekly',
      language: locale === 'en' ? 'en' : 'es',
      region: 'US',
    });

    if (window.google?.maps?.importLibrary) {
      resolve(window.google.maps);
    } else {
      reject(new Error('No se pudo inicializar Google Maps importLibrary'));
    }
  });

  return googleMapsLoaderPromise;
}

export default function DashboardGoogleMap({ loads = [], trucks = [], locale = 'es' }) {
  const mapContainerRef = useRef(null);
  const leafletContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const leafletInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const geocodeCacheRef = useRef(new Map());

  const [useFallbackDarkMap, setUseFallbackDarkMap] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [trafficEnabled, setTrafficEnabled] = useState(true);
  const trafficLayerRef = useRef(null);
  const [selectedRouteInfo, setSelectedRouteInfo] = useState(null);

  const isEs = locale !== 'en';
  const activeLoads = loads.slice(0, 6);
  const inTransitCount = loads.filter((l) => l.estado === 'en_transito').length;

  // 1. Obtener GOOGLE_MAPS_API_KEY desde marketChat (ya desplegada en Base44) o getGoogleMapsConfig o .env
  useEffect(() => {
    let cancelled = false;

    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (!cancelled) {
        setUseFallbackDarkMap(true);
      }
      if (typeof prevAuthFailure === 'function') prevAuthFailure();
    };

    async function init() {
      let apiKey = cachedRuntimeApiKey;

      if (!apiKey) {
        try {
          const chatRes = await base44.functions.invoke('marketChat', {
            action: 'get_maps_config',
          });
          const chatData = chatRes?.data || chatRes || {};
          if (chatData.apiKey) {
            apiKey = String(chatData.apiKey).trim();
            cachedRuntimeApiKey = apiKey;
          }
        } catch (_) {}
      }

      if (!apiKey) {
        try {
          const cfgRes = await base44.functions.invoke('getGoogleMapsConfig', {});
          const cfgData = cfgRes?.data || cfgRes || {};
          if (cfgData.apiKey) {
            apiKey = String(cfgData.apiKey).trim();
            cachedRuntimeApiKey = apiKey;
          }
        } catch (_) {}
      }

      if (cancelled) return;

      if (!apiKey) {
        setUseFallbackDarkMap(true);
        return;
      }

      try {
        await loadGoogleMapsBootstrap(apiKey, locale);
        const { Map, ColorScheme, TrafficLayer } = await window.google.maps.importLibrary('maps');

        if (cancelled || !mapContainerRef.current) return;

        const map = new Map(mapContainerRef.current, {
          center: { lat: 27.6648, lng: -81.5158 },
          zoom: 6,
          mapId: 'DEMO_MAP_ID',
          colorScheme: ColorScheme?.DARK || 'DARK',
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
        });

        const trafficLayer = new TrafficLayer();
        trafficLayer.setMap(map);
        trafficLayerRef.current = trafficLayer;

        mapInstanceRef.current = map;
        setMapReady(true);

        // Verificar si Google Maps arrojó error de API no habilitada o restricción de llave
        setTimeout(() => {
          if (cancelled || !mapContainerRef.current) return;
          const hasGmError = mapContainerRef.current.querySelector('.gm-err-container');
          if (hasGmError) {
            setUseFallbackDarkMap(true);
          }
        }, 2000);
      } catch (_) {
        if (!cancelled) {
          setUseFallbackDarkMap(true);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  // 2. Renderizar Mapa Interactivo en Modo Oscuro (OpenStreetMap con filtro oscuro libre de API Key)
  useEffect(() => {
    if (!useFallbackDarkMap || !leafletContainerRef.current) return;

    let cancelled = false;
    ensureLeafletCss();

    async function initLeafletDarkMap() {
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
        });

        // Teselas oficiales de OpenStreetMap (100% libres de API Key, nunca muestran marca de agua)
        // estilizadas en Modo Oscuro mediante la clase CSS .trucky-dark-map-tiles
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
            const oKey = String(load.origen || '').trim().toLowerCase();
            const dKey = String(load.destino || '').trim().toLowerCase();
            const oPos = geocodeCacheRef.current.get(oKey) || resolveLocalHubCoords(load.origen);
            const dPos = geocodeCacheRef.current.get(dKey) || resolveLocalHubCoords(load.destino);

            if (oPos) {
              boundsPoints.push([oPos.lat, oPos.lng]);
              const m = L.marker([oPos.lat, oPos.lng], {
                icon: createPinIcon('#5B2BA0', 'O'),
              }).addTo(map);
              m.on('click', () => setSelectedRouteInfo(load));
            }

            if (dPos) {
              boundsPoints.push([dPos.lat, dPos.lng]);
              const isTransit = load.estado === 'en_transito';
              const m = L.marker([dPos.lat, dPos.lng], {
                icon: createPinIcon(isTransit ? '#10b981' : '#8b5cf6', 'D'),
              }).addTo(map);
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
              opacity: 0.65,
              dashArray: '6, 6',
            }
          ).addTo(map);
        }

        if (boundsPoints.length > 1) {
          map.fitBounds(boundsPoints, { padding: [35, 35] });
        }

        setTimeout(() => {
          map.invalidateSize();
        }, 200);

        leafletInstanceRef.current = map;
      } catch (err) {
        console.warn('[DashboardGoogleMap] Error inicializando mapa oscuro:', err);
      }
    }

    initLeafletDarkMap();

    return () => {
      cancelled = true;
      if (leafletInstanceRef.current) {
        leafletInstanceRef.current.remove();
        leafletInstanceRef.current = null;
      }
    };
  }, [useFallbackDarkMap, activeLoads]);

  // 3. Alternar capa de tráfico en Google Maps
  useEffect(() => {
    if (!trafficLayerRef.current || !mapInstanceRef.current) return;
    trafficLayerRef.current.setMap(trafficEnabled ? mapInstanceRef.current : null);
  }, [trafficEnabled]);

  // 4. Renderizar marcadores en Google Maps cuando Maps JS API está activa
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || useFallbackDarkMap) return;

    let cancelled = false;

    async function renderGoogleMarkers() {
      try {
        const { AdvancedMarkerElement, PinElement } = await window.google.maps.importLibrary('marker');
        const { LatLngBounds } = await window.google.maps.importLibrary('core');

        if (cancelled) return;

        markersRef.current.forEach((m) => {
          m.map = null;
        });
        markersRef.current = [];

        polylinesRef.current.forEach((p) => {
          p.setMap(null);
        });
        polylinesRef.current = [];

        const bounds = new LatLngBounds();
        let hasValidPoints = false;

        if (activeLoads.length > 0) {
          for (const load of activeLoads) {
            const oKey = String(load.origen || '').trim().toLowerCase();
            const dKey = String(load.destino || '').trim().toLowerCase();
            const originPos = geocodeCacheRef.current.get(oKey) || resolveLocalHubCoords(load.origen);
            const destPos = geocodeCacheRef.current.get(dKey) || resolveLocalHubCoords(load.destino);

            if (originPos) {
              bounds.extend(originPos);
              hasValidPoints = true;
              const originPin = new PinElement({
                background: '#5B2BA0',
                borderColor: '#ffffff',
                glyphColor: '#ffffff',
                glyphText: 'O',
                scale: 0.95,
              });
              const originMarker = new AdvancedMarkerElement({
                map: mapInstanceRef.current,
                position: originPos,
                title: `${isEs ? 'Origen' : 'Origin'}: ${load.origen} → ${load.destino}`,
              });
              originMarker.append(originPin);
              originMarker.addEventListener('click', () => setSelectedRouteInfo(load));
              markersRef.current.push(originMarker);
            }

            if (destPos) {
              bounds.extend(destPos);
              hasValidPoints = true;
              const isInTransit = load.estado === 'en_transito';
              const destPin = new PinElement({
                background: isInTransit ? '#10b981' : '#8b5cf6',
                borderColor: '#ffffff',
                glyphColor: '#ffffff',
                glyphText: 'D',
                scale: 0.95,
              });
              const destMarker = new AdvancedMarkerElement({
                map: mapInstanceRef.current,
                position: destPos,
                title: `${isEs ? 'Destino' : 'Destination'}: ${load.destino}`,
              });
              destMarker.append(destPin);
              destMarker.addEventListener('click', () => setSelectedRouteInfo(load));
              markersRef.current.push(destMarker);
            }

            if (originPos && destPos) {
              const line = new window.google.maps.Polyline({
                path: [originPos, destPos],
                geodesic: true,
                strokeColor: load.estado === 'en_transito' ? '#10b981' : '#a855f7',
                strokeOpacity: 0.85,
                strokeWeight: 3,
                map: mapInstanceRef.current,
              });
              polylinesRef.current.push(line);
            }
          }
        } else {
          for (const hub of DEFAULT_HUBS_DISPLAY) {
            const pos = { lat: hub.lat, lng: hub.lng };
            bounds.extend(pos);
            hasValidPoints = true;
            const pin = new PinElement({
              background: '#5B2BA0',
              borderColor: '#ffffff',
              glyphColor: '#ffffff',
              glyphText: 'T',
              scale: 0.9,
            });
            const marker = new AdvancedMarkerElement({
              map: mapInstanceRef.current,
              position: pos,
              title: `${hub.name} (${hub.role})`,
            });
            marker.append(pin);
            markersRef.current.push(marker);
          }
        }

        if (hasValidPoints && !cancelled) {
          mapInstanceRef.current.fitBounds(bounds, 55);
        }
      } catch (_) {}
    }

    renderGoogleMarkers();

    return () => {
      cancelled = true;
    };
  }, [mapReady, useFallbackDarkMap, activeLoads, isEs]);

  const handleRecenter = () => {
    setSelectedRouteInfo(null);
    if (useFallbackDarkMap && leafletInstanceRef.current) {
      leafletInstanceRef.current.setView([27.8, -81.7], 6);
      return;
    }
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: 27.6648, lng: -81.5158 });
      mapInstanceRef.current.setZoom(6);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="glass-panel rounded-2xl p-5 relative overflow-hidden max-w-full"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      {/* Encabezado del Mapa */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#5B2BA0] border border-white/20 shadow-md shadow-[#5B2BA0]/35 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white truncate">
                {isEs ? 'Mapa Operativo de Rutas y Flota (Google Maps)' : 'Live Fleet & Routes Map (Google Maps)'}
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

        {/* Controles rápidos del mapa */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
          {!useFallbackDarkMap && (
            <button
              type="button"
              onClick={() => setTrafficEnabled((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                trafficEnabled
                  ? 'bg-[#5B2BA0] text-white border-white/25 shadow-sm shadow-[#5B2BA0]/40'
                  : 'bg-white/[0.04] text-white/70 border-white/10 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{isEs ? 'Tráfico en vivo' : 'Live Traffic'}</span>
            </button>
          )}

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

      {/* Contenedor del Mapa con altura compacta (340px) */}
      <div className="relative w-full h-[340px] rounded-2xl overflow-hidden border border-white/15 bg-[#0d0818] shadow-inner">
        <div
          ref={mapContainerRef}
          className={`w-full h-full ${useFallbackDarkMap ? 'hidden' : 'block'}`}
        />

        {useFallbackDarkMap && (
          <div ref={leafletContainerRef} className="w-full h-full z-0" />
        )}

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
