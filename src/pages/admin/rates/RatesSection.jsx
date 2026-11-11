// F6-01 — Sección "Tarifas" dentro del Panel Admin.
// El Excel es la entrada principal (cada carga = una nueva versión de las
// tarifas, con control de calidad y vista previa). Rutas y Zonas sirven para
// consultar y hacer ajustes puntuales. La primera vez, si la base está vacía, se cargan
// solas las tarifas actuales del sistema (no hay que hacer nada a mano).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { loadCatalog, migrateRates } from '@/lib/ratesApi';
import { ErrorBox, Empty } from './ui';
import ChangePreview from './ChangePreview';
import useSaveFlow from './useSaveFlow';
import RoutesTab from './RoutesTab';
import { ZonesTab } from './SimpleTabs';
import { ExcelTab } from './OtherTabs';

const TABS = [
  { id: 'excel', label: 'Cargar Excel' },
  { id: 'rutas', label: 'Rutas' },
  { id: 'zonas', label: 'Zonas' },
];

const anyEmpty = (d) => !d.routes.length || !d.zones.length || !d.accessorials.length || !d.aliases.length;

export default function RatesSection() {
  const [tab, setTab] = useState('excel');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [init, setInit] = useState(null); // { estado: 'cargando' | 'ok' | 'diferencias', diffs }
  const [legacy, setLegacy] = useState(0);
  const triedInit = useRef(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      let d = await loadCatalog();
      // Carga inicial automática: solo tablas vacías, una vez por visita.
      if (anyEmpty(d) && !triedInit.current) {
        triedInit.current = true;
        setInit({ estado: 'cargando' });
        await migrateRates('apply', { soloVacias: true });
        const v = await migrateRates('verify');
        setInit({ estado: v?.ok ? 'ok' : 'diferencias', diffs: v?.diffs || [] });
        d = await loadCatalog();
      }
      setData(d);
    } catch (e) {
      setError(e.message);
      setInit((s) => (s?.estado === 'cargando' ? null : s));
      setData((prev) => prev || { routes: [], zones: [], accessorials: [], aliases: [] });
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Tarifas antiguas (método anterior). El cotizador las consulta antes que
  // estas, así que se avisa si existen.
  useEffect(() => {
    base44.entities.ContainerRoute.filter({}, null, 1000)
      .then((rows) => setLegacy(Array.isArray(rows) ? rows.length : 0))
      .catch(() => setLegacy(0));
  }, []);

  const flow = useSaveFlow(reload);

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/50">
        Rutas, zonas y accesoriales que usa el chat para cotizar drayage. Cada cambio se revisa antes de guardar y el chat lo usa en máximo 1 minuto.
      </p>

      {init?.estado === 'cargando' && (
        <div className="text-sm text-sky-200 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
          Preparando las tarifas por primera vez: copiando las tarifas actuales del sistema…
        </div>
      )}
      {init?.estado === 'ok' && (
        <div className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> Se cargaron las tarifas actuales del sistema: son idénticas a las que usaba el chat (0 diferencias).
        </div>
      )}
      {init?.estado === 'diferencias' && (
        <ErrorBox error={`La carga inicial terminó con diferencias (${init.diffs.length}). Avisa a soporte antes de editar. ${init.diffs.slice(0, 3).join(' · ')}`} />
      )}
      {legacy > 0 && (
        <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Hay {legacy} tarifas de contenedor cargadas con el método anterior (ContainerRoute). Para esas ciudades el chat las usa antes que estas. Consulta con soporte antes de cambiarlas.</span>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-colors ${tab === t.id ? 'bg-white/15 text-white font-medium border border-white/20' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBox error={error} />
      {!data ? <Empty>Cargando tarifas…</Empty> : (
        <>
          {tab === 'excel' && <ExcelTab onSaved={reload} />}
          {tab === 'rutas' && <RoutesTab data={data} flow={flow} />}
          {tab === 'zonas' && <ZonesTab data={data} flow={flow} />}
        </>
      )}

      {flow.pending && <ChangePreview preview={flow.pending.preview} onConfirm={flow.confirm} onClose={flow.cancel} />}
    </div>
  );
}
