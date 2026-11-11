// Pestaña Rutas: buscar, ver y editar rutas (precios por tamaño, piso, millas…).
import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Card, Btn, Field, Input, Select, TextArea, Badge, Modal, ErrorBox, Empty, Table, Td } from './ui';
import { TAMANOS, money } from '@/lib/ratesApi';

const priceOf = (r, t) => (r.precios || []).find((p) => p.tamano === t);

function RouteEditor({ route, zones, onClose, onReview, onDelete, busy, error }) {
  const isNew = !route;
  const [f, setF] = useState(() => ({
    estado: route?.estado || 'FL',
    ciudad: route?.ciudad || '',
    mercado: route?.mercado || '',
    zona: route?.zona || '',
    grupo: route?.grupo ?? '',
    millas_ida: route?.millas_ida ?? '',
    activo: route?.activo !== false,
    notas: route?.notas || '',
    precios: Object.fromEntries(TAMANOS.map(({ id }) => {
      const p = route ? priceOf(route, id) : null;
      return [id, { objetivo: p?.objetivo ?? '', piso: p?.piso_tabla ?? '', derivado: p?.derivado ?? false }];
    })),
  }));
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setPrice = (t, k, v) => setF((s) => ({ ...s, precios: { ...s.precios, [t]: { ...s.precios[t], [k]: v } } }));
  const zonasEstado = zones.filter((z) => z.estado === f.estado && z.activo !== false);

  const submit = () => {
    const num = (v) => (v === '' || v == null ? null : Number(v));
    // Se conserva el orden original de tamaños de la ruta; los vacíos se quitan.
    const orden = route ? (route.precios || []).map((p) => p.tamano) : [];
    const tams = [...orden, ...TAMANOS.map((t) => t.id).filter((t) => !orden.includes(t))];
    const precios = tams
      .filter((t) => num(f.precios[t].objetivo) != null)
      .map((t) => ({ tamano: t, objetivo: num(f.precios[t].objetivo), piso_tabla: num(f.precios[t].piso), derivado: !!f.precios[t].derivado }));
    const data = {
      ciudad: f.ciudad.trim(), mercado: f.mercado.trim(), zona: f.zona,
      grupo: f.grupo === '' ? null : String(f.grupo), millas_ida: num(f.millas_ida),
      precios, activo: f.activo, notas: f.notas,
      ...(isNew ? { estado: f.estado } : {}),
    };
    onReview('RateRoute', [{ key: route?.route_id ?? null, data }]);
  };

  return (
    <Modal title={isNew ? 'Nueva ruta' : `Editar ruta · ${route.ciudad}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Estado">
          <Select value={f.estado} disabled={!isNew} onChange={(e) => set('estado', e.target.value)}>
            <option>FL</option><option>TX</option>
          </Select>
        </Field>
        <Field label="Ciudad"><Input value={f.ciudad} onChange={(e) => set('ciudad', e.target.value)} /></Field>
        <Field label="Mercado / puerto"><Input value={f.mercado} onChange={(e) => set('mercado', e.target.value)} /></Field>
        <Field label="Zona">
          <Select value={f.zona} onChange={(e) => set('zona', e.target.value)}>
            <option value="">—</option>
            {zonasEstado.map((z) => <option key={z.zone_key} value={z.zona}>{z.zona}</option>)}
          </Select>
        </Field>
        <Field label="Grupo"><Input value={f.grupo ?? ''} onChange={(e) => set('grupo', e.target.value)} /></Field>
        <Field label="Millas (ida)"><Input type="number" min="0" value={f.millas_ida} onChange={(e) => set('millas_ida', e.target.value)} /></Field>
        <Field label="Activa">
          <Select value={f.activo ? '1' : '0'} onChange={(e) => set('activo', e.target.value === '1')}>
            <option value="1">Sí, el chat la usa</option><option value="0">No (apagada temporalmente)</option>
          </Select>
        </Field>
      </div>
      <div>
        <p className="text-xs font-medium text-white/60 mb-2">Precios (vacío = la ruta no tiene ese tamaño)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TAMANOS.map(({ id, label }) => (
            <div key={id} className="bg-white/5 rounded-xl p-2 space-y-2">
              <p className="text-xs text-white font-medium">{label}{f.precios[id].derivado && <Badge tone="blue"> derivado</Badge>}</p>
              <Input type="number" min="0" placeholder="Objetivo $" value={f.precios[id].objetivo} onChange={(e) => setPrice(id, 'objetivo', e.target.value)} />
              <Input type="number" min="0" placeholder="Piso $" value={f.precios[id].piso} onChange={(e) => setPrice(id, 'piso', e.target.value)} />
            </div>
          ))}
        </div>
      </div>
      <Field label="Nota interna"><TextArea value={f.notas} onChange={(e) => set('notas', e.target.value)} /></Field>
      {route?.fuente?.archivo && <p className="text-[11px] text-white/40">Origen: {route.fuente.archivo}, fila {route.fuente.fila} · clave {route.route_id}</p>}
      <ErrorBox error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {!isNew && <Btn variant="danger" className="mr-auto" onClick={onDelete} disabled={busy}><Trash2 className="w-4 h-4" /> Eliminar ruta</Btn>}
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={submit} busy={busy}>Revisar cambios</Btn>
      </div>
    </Modal>
  );
}

export default function RoutesTab({ data, flow }) {
  const [estado, setEstado] = useState('FL');
  const [zona, setZona] = useState('');
  const [q, setQ] = useState('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = cerrado, null = nueva

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.routes.filter((r) => r.estado === estado
      && (!zona || r.zona === zona)
      && (verInactivas || r.activo !== false)
      && (!t || `${r.ciudad} ${r.mercado} ${r.grupo ?? ''}`.toLowerCase().includes(t)));
  }, [data.routes, estado, zona, q, verInactivas]);
  const zonas = data.zones.filter((z) => z.estado === estado);

  const review = async (entity, changes) => { if (await flow.review(entity, changes)) setEditing(undefined); };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Estado">
          <Select value={estado} onChange={(e) => { setEstado(e.target.value); setZona(''); }}>
            <option>FL</option><option>TX</option>
          </Select>
        </Field>
        <Field label="Zona">
          <Select value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas</option>
            {zonas.map((z) => <option key={z.zone_key} value={z.zona}>{z.zona}</option>)}
          </Select>
        </Field>
        <Field label="Buscar">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <Input className="pl-9" placeholder="Ciudad, mercado o grupo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </Field>
        <label className="flex items-center gap-2 text-xs text-white/60 pb-2">
          <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Ver desactivadas
        </label>
        <div className="flex-1" />
        <Btn onClick={() => setEditing(null)}><Plus className="w-4 h-4" /> Nueva ruta</Btn>
      </div>
      <p className="text-xs text-white/40">{rows.length} rutas</p>
      {rows.length === 0 ? <Empty>No hay rutas con este filtro.</Empty> : (
        <Table head={['Ciudad', 'Mercado', 'Zona', 'Grupo', 'Millas', ...TAMANOS.map((t) => t.label), '']}>
          {rows.map((r) => (
            <tr key={r.id} className={r.activo === false ? 'opacity-40' : ''}>
              <Td className="text-white">{r.ciudad}{r.activo === false && <> <Badge tone="red">inactiva</Badge></>}</Td>
              <Td>{r.mercado}</Td>
              <Td>{r.zona}</Td>
              <Td>{r.grupo ?? '—'}</Td>
              <Td>{r.millas_ida}</Td>
              {TAMANOS.map(({ id }) => {
                const p = priceOf(r, id);
                return (
                  <Td key={id} className="whitespace-nowrap">
                    {p ? <>{money(p.objetivo)}{p.piso_tabla != null && <span className="block text-[11px] text-white/40">piso {money(p.piso_tabla)}</span>}</> : <span className="text-white/30">—</span>}
                  </Td>
                );
              })}
              <Td><button onClick={() => setEditing(r)} className="text-amber-400 hover:text-amber-300" title="Editar"><Pencil className="w-4 h-4" /></button></Td>
            </tr>
          ))}
        </Table>
      )}
      {editing !== undefined && (
        <RouteEditor route={editing} zones={data.zones} onClose={() => { setEditing(undefined); flow.setError(null); }}
          onReview={review} onDelete={() => review('RateRoute', [{ key: editing.route_id, eliminar: true }])}
          busy={flow.busy} error={flow.error} />
      )}
    </Card>
  );
}
