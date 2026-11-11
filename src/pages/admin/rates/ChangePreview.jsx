// Muestra lo que el servidor VA a cambiar (antes → después) y pide confirmación.
// Nada se guarda hasta presionar "Confirmar y guardar".
import React, { useState } from 'react';
import { Btn, Badge, ErrorBox, Modal } from './ui';
import { money } from '@/lib/ratesApi';

export function fmt(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'precios' && Array.isArray(v)) {
    return v.map((p) => `${p.tamano}: ${money(p.objetivo)}${p.piso_tabla != null ? ` (piso ${money(p.piso_tabla)})` : ''}`).join(' · ');
  }
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Precios: solo se muestran los tamaños que cambian (objetivo y piso).
function PreciosDiff({ antes = [], despues = [] }) {
  const by = (l) => Object.fromEntries((l || []).map((p) => [p.tamano, p]));
  const a = by(antes); const d = by(despues);
  const tams = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  const one = (p) => (p ? `${money(p.objetivo)}${p.piso_tabla != null ? ` (piso ${money(p.piso_tabla)})` : ''}` : 'sin precio');
  return tams.filter((t) => fmt('precios', [a[t]].filter(Boolean)) !== fmt('precios', [d[t]].filter(Boolean))).map((t) => (
    <div key={t} className="text-xs grid md:grid-cols-[110px_1fr] gap-1">
      <span className="text-white/50">precio {t}</span>
      <span><span className="text-red-300 line-through">{one(a[t])}</span>{' → '}<span className="text-emerald-300">{one(d[t])}</span></span>
    </div>
  ));
}

const ENT = { RateRoute: 'ruta', RateZone: 'zona', RateAccessorial: 'accesorial', RateAlias: 'alias' };

const Row = ({ tone, label, k, children }) => (
  <div className="border border-white/5 rounded-xl p-3 space-y-1">
    <div className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge><span className="text-xs text-white/60 break-all">{k}</span></div>
    {children}
  </div>
);

export default function ChangePreview({ preview, onConfirm, onClose, extra }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const p = preview || {};
  const errores = p.errores || [];
  const total = (p.crear?.length || 0) + (p.actualizar?.length || 0) + (p.eliminar?.length || 0);

  const confirm = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title="Revisar cambios antes de guardar" onClose={onClose} wide>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="green">Nuevas: {p.crear?.length || 0}</Badge>
        <Badge tone="amber">Modificadas: {p.actualizar?.length || 0}</Badge>
        <Badge tone="red">Eliminadas: {p.eliminar?.length || 0}</Badge>
        <Badge>Sin cambio: {p.iguales || 0}</Badge>
      </div>
      {(p.avisos || []).map((a) => <p key={a} className="text-xs text-amber-300">⚠ {a}</p>)}
      {errores.length > 0 && (
        <ErrorBox error={<>No se puede guardar, corrige esto:<ul className="list-disc ml-5 mt-1">{errores.map((e, i) => <li key={i}>{e.key ? `${e.key}: ` : ''}{e.mensaje}</li>)}</ul></>} />
      )}
      <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
        {(p.actualizar || []).map((u) => (
          <Row key={`${u.entidad}-${u.key}`} tone="amber" label={`Modificar${ENT[u.entidad] ? ` ${ENT[u.entidad]}` : ''}`} k={u.key}>
            {(u.campos || []).map((c) => c === 'precios' ? <PreciosDiff key={c} antes={u.antes?.precios} despues={u.despues?.precios} /> : (
              <div key={c} className="text-xs grid md:grid-cols-[110px_1fr] gap-1">
                <span className="text-white/50">{c}</span>
                <span><span className="text-red-300 line-through">{fmt(c, u.antes?.[c])}</span>{' → '}<span className="text-emerald-300">{fmt(c, u.despues?.[c])}</span></span>
              </div>
            ))}
          </Row>
        ))}
        {(p.crear || []).map((c) => (
          <Row key={`${c.entidad}-${c.key}`} tone="green" label={`Nueva${ENT[c.entidad] ? ` ${ENT[c.entidad]}` : ''}`} k={c.key}>
            <p className="text-xs text-white/70">{c.resumen || fmt('', c.despues)}</p>
          </Row>
        ))}
        {(p.eliminar || []).map((d) => (
          <Row key={`${d.entidad}-${d.key}`} tone="red" label={`Eliminar${ENT[d.entidad] ? ` ${ENT[d.entidad]}` : ''}`} k={d.key}>
            <p className="text-xs text-white/70">{d.resumen || 'Se borra de la base; queda registrado en el historial.'}</p>
          </Row>
        ))}
        {total === 0 && errores.length === 0 && <p className="text-sm text-white/50">No hay diferencias: no hay nada que guardar.</p>}
      </div>
      {extra}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={confirm} busy={busy} disabled={total === 0 || errores.length > 0}>Confirmar y guardar</Btn>
      </div>
    </Modal>
  );
}
