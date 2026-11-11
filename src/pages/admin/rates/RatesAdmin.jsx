// F6-01 · Fase D — Pantalla "Tarifas" (solo administradores).
// Carga todo el catálogo una vez y lo comparte con las pestañas. Cada guardado
// pasa por la vista previa del servidor y luego recarga los datos.
import React, { useCallback, useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadCatalog } from '@/lib/ratesApi';
import { Btn, ErrorBox, Empty } from './ui';
import ChangePreview from './ChangePreview';
import useSaveFlow from './useSaveFlow';
import RoutesTab from './RoutesTab';
import { ZonesTab, AccessorialsTab, AliasesTab } from './SimpleTabs';
import { ExcelTab, HistoryTab, MigrationTab } from './OtherTabs';

const TABS = [
  { id: 'rutas', label: 'Rutas' },
  { id: 'zonas', label: 'Zonas' },
  { id: 'accesoriales', label: 'Accesoriales' },
  { id: 'alias', label: 'Alias' },
  { id: 'excel', label: 'Cargar Excel' },
  { id: 'historial', label: 'Historial' },
  { id: 'migracion', label: 'Migración' },
];

export default function RatesAdmin() {
  const [tab, setTab] = useState('rutas');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(async () => {
    setError(null);
    try { setData(await loadCatalog()); } catch (e) { setError(e.message); setData({ routes: [], zones: [], accessorials: [], aliases: [] }); }
    setReloadKey((k) => k + 1);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const flow = useSaveFlow(reload);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tags className="w-6 h-6 text-amber-500" />
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-xl font-bold text-white">Tarifas</h1>
          <p className="text-xs text-white/50">Rutas, zonas y accesoriales que usa el chat. Los cambios se reflejan en el chat en máximo 1 minuto.</p>
        </div>
        <Link to="/admin" className="text-xs text-amber-400 hover:text-amber-300">Mercado por estado y cinta →</Link>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-colors ${tab === t.id ? 'bg-amber-500 text-black font-medium' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBox error={error} />
      {!data ? <Empty>Cargando tarifas…</Empty> : (
        <>
          {data.routes.length === 0 && tab !== 'migracion' && (
            <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex flex-wrap items-center gap-3">
              La base de tarifas está vacía: el chat sigue usando las tarifas del sistema. Corre la migración para poder verlas y editarlas aquí.
              <Btn variant="ghost" onClick={() => setTab('migracion')}>Ir a Migración</Btn>
            </div>
          )}
          {tab === 'rutas' && <RoutesTab data={data} flow={flow} />}
          {tab === 'zonas' && <ZonesTab data={data} flow={flow} />}
          {tab === 'accesoriales' && <AccessorialsTab data={data} flow={flow} />}
          {tab === 'alias' && <AliasesTab data={data} flow={flow} />}
          {tab === 'excel' && <ExcelTab onSaved={reload} />}
          {tab === 'historial' && <HistoryTab reloadKey={reloadKey} />}
          {tab === 'migracion' && <MigrationTab data={data} onSaved={reload} />}
        </>
      )}

      {flow.pending && <ChangePreview preview={flow.pending.preview} onConfirm={flow.confirm} onClose={flow.cancel} />}
    </div>
  );
}
