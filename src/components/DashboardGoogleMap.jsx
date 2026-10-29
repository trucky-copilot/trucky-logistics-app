import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Navigation, Layers, Compass, AlertCircle, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Componente de Mapa Interactivo de Google Maps en Modo Oscuro para el Dashboard de Trucky.
 * - En local: toma GOOGLE_MAPS_API_KEY o VITE_GOOGLE_MAPS_API_KEY del archivo .env.
 * - En producción (Base44): obtiene automáticamente el secreto GOOGLE_MAPS_API_KEY de Base44 Secrets
 *   mediante la función backend `getGoogleMapsConfig`.
 * - Usa ColorScheme.DARK, AdvancedMarkerElement con mapId="DEMO_MAP_ID" e internalUsageAttributionIds: ['gmp_git_agentskills_v1'].
 */

const ENV_GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.GOOGLE_MAPS_API_KEY ||
  '';

let cachedRuntimeApiKey = ENV_GOOGLE_MAPS_API_KEY || '';
let googleMapsLoaderPromise = null;

async function resolveGoogleMapsApiKey() {
  if (cachedRuntimeApiKey) {
    return cachedRuntimeApiKey;
  }
  try {
    const res = await base44.functions.invoke('getGoogleMapsConfig', {});
    const secretKey = res?.data?.apiKey || res?.apiKey || '';
    if (secretKey) {
      cachedRuntimeApiKey = String(secretKey).trim();
      return cachedRuntimeApiKey;
    }
  } catch (err) {
    console.warn('[DashboardGoogleMap] No se pudo obtener GOOGLE_MAPS_API_KEY desde getGoogleMapsConfig:', err);
  }
  return '';
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
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const geocodeCacheRef = useRef(new Map());

  const [mapReady, setMapReady] = useState(false);
  const [loadingKey, setLoadingKey] = useState(true);
  const [mapError, setMapError] = useState(null);
  const [trafficEnabled, setTrafficEnabled] = useState(true);
  const trafficLayerRef = useRef(null);
  const [selectedRouteInfo, setSelectedRouteInfo] = useState(null);

  const isEs = locale !== 'en';
  const activeLoads = loads.slice(0, 6);
  const inTransitCount = loads.filter((l) => l.estado === 'en_transito').length;

  // 1. Obtener API Key (.env local o Secreto GOOGLE_MAPS_API_KEY de Base44 en producción) e inicializar el mapa en Modo Oscuro
  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      setLoadingKey(true);
      setMapError(null);

      const apiKey = await resolveGoogleMapsApiKey();
      if (cancelled) return;

      if (!apiKey) {
        setLoadingKey(false);
        setMapError(
          isEs
            ? 'No se encontró el secreto GOOGLE_MAPS_API_KEY en el entorno de Base44 ni en .env.'
            : 'GOOGLE_MAPS_API_KEY secret was not found in Base44 environment or .env.'
        );
        return;
      }

      try {
        await loadGoogleMapsBootstrap(apiKey, locale);
        const { Map, ColorScheme, TrafficLayer } = await window.google.maps.importLibrary('maps');

        if (cancelled || !mapContainerRef.current) return;

        const map = new Map(mapContainerRef.current, {
          center: { lat: 28.5383, lng: -81.3792 },
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
        setLoadingKey(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[DashboardGoogleMap] Error cargando Google Maps:', err);
          setLoadingKey(false);
          setMapError(
            isEs
              ? 'No se pudo cargar el mapa interactivo. Verifica que Maps JavaScript API esté habilitada para GOOGLE_MAPS_API_KEY en Google Cloud.'
              : 'Could not load interactive map. Verify that Maps JavaScript API is enabled for GOOGLE_MAPS_API_KEY in Google Cloud.'
          );
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
    };
  }, [locale, isEs]);

  // 2. Alternar capa de tráfico en vivo
  useEffect(() => {
    if (!trafficLayerRef.current || !mapInstanceRef.current) return;
    trafficLayerRef.current.setMap(trafficEnabled ? mapInstanceRef.current : null);
  }, [trafficEnabled]);

  // 3. Geocodificar y dibujar en el mapa las rutas de las cargas recientes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    let cancelled = false;

    async function renderLoadMarkersAndRoutes() {
      try {
        const { AdvancedMarkerElement, PinElement } = await window.google.maps.importLibrary('marker');
        const { Geocoder } = await window.google.maps.importLibrary('geocoding');
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

        if (activeLoads.length === 0) return;

        const geocoder = new Geocoder();
        const bounds = new LatLngBounds();
        let hasValidPoints = false;

        const geocodeAddress = async (address) => {
          if (!address) return null;
          const key = String(address).trim().toLowerCase();
          if (geocodeCacheRef.current.has(key)) {
            return geocodeCacheRef.current.get(key);
          }
          try {
            const response = await geocoder.geocode({ address: `${address}, USA` });
            const loc = response?.results?.[0]?.geometry?.location;
            if (loc) {
              const point = { lat: loc.lat(), lng: loc.lng() };
              geocodeCacheRef.current.set(key, point);
              return point;
            }
          } catch (_) {}
          return null;
        };

        for (const load of activeLoads) {
          if (cancelled) return;
          const originPos = await geocodeAddress(load.origen);
          const destPos = await geocodeAddress(load.destino);

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
            originMarker.addEventListener('click', () => {
              setSelectedRouteInfo(load);
            });
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
              title: `${isEs ? 'Destino' : 'Destination'}: ${load.destino} (${load.broker_nombre || 'Broker'})`,
            });
            destMarker.append(destPin);
            destMarker.addEventListener('click', () => {
              setSelectedRouteInfo(load);
            });
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

        if (hasValidPoints && !cancelled) {
          mapInstanceRef.current.fitBounds(bounds, 55);
        }
      } catch (err) {
        console.warn('[DashboardGoogleMap] Aviso al renderizar marcadores:', err);
      }
    }

    renderLoadMarkersAndRoutes();

    return () => {
      cancelled = true;
    };
  }, [mapReady, activeLoads, isEs]);

  const handleRecenter = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.panTo({ lat: 28.5383, lng: -81.3792 });
    mapInstanceRef.current.setZoom(6);
    setSelectedRouteInfo(null);
  };

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="glass-panel rounded-2xl p-5 relative overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      {/* Encabezado del Mapa */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#5B2BA0] border border-white/20 shadow-md shadow-[#5B2BA0]/35 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">
                {isEs ? 'Mapa Operativo de Rutas y Flota (Google Maps)' : 'Live Fleet & Routes Map (Google Maps)'}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-400/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            </div>
            <p className="text-xs text-white/60">
              {isEs
                ? `${activeLoads.length} rutas activas mapeadas · ${inTransitCount} en tránsito · ${trucks.length} camiones registrados`
                : `${activeLoads.length} active routes mapped · ${inTransitCount} in transit · ${trucks.length} registered trucks`}
            </p>
          </div>
        </div>

        {/* Controles rápidos del mapa */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
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

      {/* Contenedor del Mapa con altura explícita (380px) */}
      <div className="relative w-full h-[380px] rounded-2xl overflow-hidden border border-white/15 bg-[#0f0b1a] shadow-inner">
        <div ref={mapContainerRef} className="w-full h-full" />

        {loadingKey && !mapError && (
          <div className="absolute inset-0 bg-[#0f0b1a]/90 flex flex-col items-center justify-center p-6 text-center space-y-2">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            <p className="text-xs text-white/70">
              {isEs ? 'Cargando Google Maps en modo oscuro...' : 'Loading Google Maps in dark mode...'}
            </p>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 bg-[#0f0b1a] flex flex-col items-center justify-center p-6 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-400" />
            <p className="text-sm font-medium text-white">{mapError}</p>
          </div>
        )}

        {/* Tarjeta flotante cuando se selecciona un marcador de carga */}
        {selectedRouteInfo && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm glass-panel rounded-xl p-3 border border-white/20 text-xs text-white shadow-xl">
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
