// Recorrido guiado para el usuario Demo (estilo "Comenzar recorrido" de Canvas).
// Bienvenida → un paso por módulo (resalta su botón del menú y abre la página) →
// termina en el Dashboard. Sale una sola vez por usuario; se puede repetir desde
// Configuración → Ayuda y soporte → "Ver recorrido de nuevo".
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Sparkles } from 'lucide-react';

export const TOUR_START_KEY = 'trucky-tour-start';
const seenKey = (email) => `trucky-tour-demo-v1:${String(email || '').toLowerCase()}`;

const STEPS = [
  { path: '/calculadora',
    es: ['Calculadora de costos', 'Aquí están tus costos: diésel, MPG, pago al conductor, seguro y lease. Con ellos Trucky calcula tu costo por milla, tu break-even y tu RPM objetivo. Puedes cambiarlos cuando quieras y el chat y el verificador usan estos valores.'],
    en: ['Cost calculator', 'Here are your costs: diesel, MPG, driver pay, insurance and lease. Trucky uses them to calculate your cost per mile, break-even and target RPM. You can change them anytime; the chat and the checker use these values.'] },
  { path: '/documentos',
    es: ['Verificador de documentos', 'Sube aquí las rate confirmations en PDF o imagen, o pega el texto. Trucky revisa la tarifa, el broker, las fechas y las cláusulas, y te dice si conviene aceptarla. Desde el resultado puedes crear la carga.'],
    en: ['Document checker', 'Upload rate confirmations here as PDF or image, or paste the text. Trucky checks the rate, broker, dates and clauses and tells you whether to accept it. From the result you can create the load.'] },
  { path: '/conductores',
    es: ['Conductores', 'Registra a tus conductores y sus documentos: licencia, médico, TWIC y HazMat. Te avisamos antes de que venzan.'],
    en: ['Drivers', 'Register your drivers and their documents: license, medical, TWIC and HazMat. We warn you before they expire.'] },
  { path: '/flota',
    es: ['Flota', 'Tus camiones con su placa, estado (disponible, en ruta, mantenimiento) y el conductor asignado.'],
    en: ['Fleet', 'Your trucks with their plate, status (available, on route, maintenance) and assigned driver.'] },
  { path: '/cargas',
    es: ['Cargas', 'Cada carga con su ruta, tarifa y ganancia o pérdida estimada. Se ven por semana y por mes, y puedes descargar el mes en PDF.'],
    en: ['Loads', 'Each load with its route, rate and estimated profit or loss. View them by week and month, and download the month as PDF.'] },
  { path: '/brokers',
    es: ['Brokers', 'Guarda a tus brokers con su calificación y días de pago, para saber con quién conviene trabajar.'],
    en: ['Brokers', 'Save your brokers with their rating and payment days, so you know who is worth working with.'] },
  { path: '/chat',
    es: ['Chat de Mercado', 'Pregunta tarifas, rutas y si una oferta te conviene. Por ejemplo: "Miami a Orlando dry van 230 millas a $800, ¿conviene?".'],
    en: ['Market Chat', 'Ask about rates, lanes and whether an offer is worth it. For example: "Miami to Orlando dry van 230 miles at $800, worth it?".'] },
  { path: '/',
    es: ['Dashboard', 'El resumen de tu semana: ingresos, ganancia, tarifa promedio, viajes, alertas y tus mejores brokers. ¡Listo para empezar!'],
    en: ['Dashboard', 'Your weekly summary: revenue, profit, average rate, trips, alerts and your top brokers. You are ready to start!'] },
];

const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 1024;

export default function DemoTour({ user, locale, isDemoUser, visiblePaths = [], setSidebarOpen }) {
  const navigate = useNavigate();
  const location = useLocation();
  const en = locale === 'en';
  const email = user?.email || '';
  const nombre = (user?.full_name || email.split('@')[0] || '').trim();
  const steps = STEPS.filter((s) => visiblePaths.includes(s.path)); // sin Emails en Demo
  const [fase, setFase] = useState(null); // null | 'welcome' | número de paso
  const [rect, setRect] = useState(null);

  const marcarVisto = useCallback(() => { try { localStorage.setItem(seenKey(email), '1'); } catch { /* sin almacenamiento */ } }, [email]);

  // Primera vez del usuario Demo, o pedido desde Ayuda y soporte.
  useEffect(() => {
    if (!email) return;
    let pedido = false;
    try { pedido = sessionStorage.getItem(TOUR_START_KEY) === '1'; } catch { /* nada */ }
    if (pedido) {
      try { sessionStorage.removeItem(TOUR_START_KEY); } catch { /* nada */ }
      setFase('welcome');
      return;
    }
    if (!isDemoUser || fase !== null) return;
    let visto = false;
    try { visto = localStorage.getItem(seenKey(email)) === '1'; } catch { visto = true; }
    if (visto) return;
    const t = setTimeout(() => setFase('welcome'), 800);
    return () => clearTimeout(t);
  }, [email, isDemoUser, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const paso = typeof fase === 'number' ? steps[fase] : null;

  // Ir al módulo del paso y ubicar su botón en el menú.
  useEffect(() => {
    if (!paso) return;
    if (location.pathname !== paso.path) navigate(paso.path);
    if (isMobile()) setSidebarOpen?.(true);
  }, [fase]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!paso) { setRect(null); return; }
    const medir = () => {
      const el = document.querySelector(`[data-tour="${paso.path}"]`);
      if (!el) { setRect(null); return; }
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      setRect(r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    medir();
    const t1 = setTimeout(medir, 150), t2 = setTimeout(medir, 400); // tras abrir el menú o cambiar de página
    window.addEventListener('resize', medir);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', medir); };
  }, [fase, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = () => {
    marcarVisto();
    setFase(null);
    if (isMobile()) setSidebarOpen?.(false);
  };
  const terminar = () => { cerrar(); navigate('/'); };

  if (fase === null || steps.length === 0) return null;

  if (fase === 'welcome') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'var(--t-overlay)' }} role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="relative w-full max-w-md rounded-2xl border border-border bg-t-bg-surface p-6 shadow-popover space-y-4">
          <button type="button" onClick={cerrar} aria-label={en ? 'Close' : 'Cerrar'} className="absolute top-3 right-3 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"><X className="w-4 h-4" /></button>
          <div className="w-12 h-12 rounded-2xl bg-t-action-primary/15 flex items-center justify-center"><Sparkles className="w-6 h-6 text-t-text-accent" /></div>
          <div>
            <h2 id="tour-title" className="text-xl font-bold text-foreground">{en ? `Hi${nombre ? `, ${nombre}` : ''}!` : `¡Hola${nombre ? `, ${nombre}` : ''}!`}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {en ? `Let us show you how Trucky works in ${steps.length} quick steps: from your costs to the dashboard.` : `Te mostramos cómo funciona Trucky en ${steps.length} pasos rápidos: desde tus costos hasta el dashboard.`}
            </p>
          </div>
          <ol className="text-sm text-foreground list-decimal pl-5 space-y-0.5">
            {steps.map((s) => <li key={s.path}>{(en ? s.en : s.es)[0]}</li>)}
          </ol>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={cerrar} className="h-10 px-4 rounded-full text-sm text-foreground hover:bg-muted">{en ? 'Not now' : 'Ahora no'}</button>
            <button type="button" onClick={() => setFase(0)} className="h-10 px-4 rounded-full bg-t-action-primary hover:bg-t-action-primary-hover text-sm font-semibold text-white">{en ? 'Start tour' : 'Comenzar recorrido'}</button>
          </div>
        </div>
      </div>
    );
  }

  const [titulo, texto] = en ? paso.en : paso.es;
  const ultimo = fase === steps.length - 1;
  // Globo a la derecha del botón del menú (escritorio) o abajo de la pantalla (celular).
  const movil = isMobile() || !rect;
  const globoStyle = movil
    ? { left: 16, right: 16, bottom: 16 }
    : { top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 260)), left: rect.left + rect.width + 20, width: 360 };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
      {/* Oscurece todo menos el botón del menú del paso */}
      {rect ? (
        <div className="fixed rounded-full pointer-events-none ring-2 ring-t-accent-lime transition-all duration-200"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 9999px var(--t-overlay)' }} />
      ) : (
        <div className="fixed inset-0" style={{ background: 'var(--t-overlay)' }} />
      )}
      <div className="fixed rounded-2xl border border-border bg-t-bg-surface p-5 shadow-popover space-y-3" style={globoStyle}>
        {!movil && <span className="absolute -left-2 top-6 w-4 h-4 rotate-45 bg-t-bg-surface border-l border-b border-border" aria-hidden="true" />}
        <div className="flex items-start gap-3">
          <h3 id="tour-step-title" className="flex-1 text-base font-semibold text-foreground">{titulo}</h3>
          <button type="button" onClick={cerrar} aria-label={en ? 'Close' : 'Cerrar'} className="p-1 -m-1 rounded-full text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-t-text-secondary">{texto}</p>
        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1 text-xs text-muted-foreground">{en ? `${fase + 1} of ${steps.length}` : `${fase + 1} de ${steps.length}`}</span>
          {fase > 0 && (
            <button type="button" onClick={() => setFase(fase - 1)} className="h-9 px-3 rounded-full text-sm text-foreground hover:bg-muted">{en ? 'Back' : 'Anterior'}</button>
          )}
          <button type="button" onClick={() => (ultimo ? terminar() : setFase(fase + 1))}
            className="h-9 px-4 rounded-full bg-t-action-primary hover:bg-t-action-primary-hover text-sm font-semibold text-white">
            {ultimo ? (en ? 'Done' : 'Listo') : (en ? 'Next' : 'Siguiente')}
          </button>
        </div>
      </div>
    </div>
  );
}
