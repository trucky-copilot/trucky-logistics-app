// Ticket 101 · Panel Admin → Planes: qué módulos ve cada plan (tabla PlanModule).
// El servidor y la pantalla leen esta misma tabla; los cambios aplican en ≤ 1 min.
import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { PLANS, MODULES, matrixFromRows } from '../../../base44/shared/planModules.ts';
import { Card, Btn, ErrorBox, Empty } from './rates/ui';

export default function PlansSection() {
  const [saved, setSaved] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  useEffect(() => {
    base44.entities.PlanModule.list()
      .then((rows) => { const m = matrixFromRows(rows); setSaved(m); setMatrix(m); })
      .catch(() => { const m = matrixFromRows([]); setSaved(m); setMatrix(m); setError('No se pudo leer la tabla de planes; se muestran los valores por defecto.'); });
  }, []);

  const toggle = (plan, mod) => { setOk(null); setMatrix((m) => ({ ...m, [plan]: { ...m[plan], [mod]: !m[plan][mod] } })); };
  const dirty = matrix && saved && JSON.stringify(matrix) !== JSON.stringify(saved);

  const guardar = async () => {
    setBusy(true); setError(null); setOk(null);
    try {
      const res = await base44.functions.invoke('adminSavePlanModules', { matrix });
      const data = res?.data ?? res;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo guardar');
      setSaved(data.matrix); setMatrix(data.matrix);
      setOk('Guardado. Los usuarios verán el cambio en máximo 1 minuto.');
    } catch (e) {
      setError(e?.response?.status === 404 ? 'La función adminSavePlanModules aún no está publicada en Base44.' : (e?.response?.data?.error || e.message));
    } finally { setBusy(false); }
  };

  if (!matrix) return <Empty>Cargando planes…</Empty>;
  return (
    <Card className="space-y-4">
      <p className="text-xs text-white/50">Qué módulos incluye cada plan. El servidor bloquea lo que no esté marcado, aunque alguien intente entrar directo.</p>
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm text-white/80 min-w-[520px]">
          <thead>
            <tr className="text-left text-xs text-white/50 border-b border-white/10">
              <th className="py-2 px-2 font-medium">Módulo</th>
              {PLANS.map((p) => <th key={p.id} className="py-2 px-2 font-medium text-center">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m.id} className="border-b border-white/5">
                <td className="py-2 px-2 text-white">{m.label}</td>
                {PLANS.map((p) => (
                  <td key={p.id} className="py-2 px-2 text-center">
                    <input type="checkbox" className="w-4 h-4 accent-amber-500" checked={matrix[p.id][m.id]} onChange={() => toggle(p.id, m.id)} aria-label={`${m.label} en ${p.label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      {ok && <p className="text-sm text-emerald-300">{ok}</p>}
      <div className="flex justify-end gap-2">
        {dirty && <Btn variant="ghost" onClick={() => setMatrix(saved)}>Descartar</Btn>}
        <Btn onClick={guardar} busy={busy} disabled={!dirty}><Save className="w-4 h-4" /> Guardar</Btn>
      </div>
    </Card>
  );
}
