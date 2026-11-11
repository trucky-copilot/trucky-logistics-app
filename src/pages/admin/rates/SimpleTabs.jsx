// Pestañas Zonas y Cargos adicionales (y el editor genérico que usan):
// lista filtrada por estado + editor con los campos definidos abajo.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, Btn, Field, Input, Select, TextArea, Badge, Modal, ErrorBox, Empty, Table, Td } from './ui';

function GenericEditor({ title, fields, initial, onClose, onSubmit, onDelete, busy, error }) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        {fields.map((fd) => (
          <Field key={fd.k} label={fd.label} hint={fd.hint}>
            {fd.type === 'select' ? (
              <Select value={f[fd.k] ?? ''} disabled={fd.disabled} onChange={(e) => set(fd.k, e.target.value)}>
                {fd.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : fd.type === 'textarea' ? (
              <TextArea value={f[fd.k] ?? ''} onChange={(e) => set(fd.k, e.target.value)} />
            ) : fd.type === 'bool' ? (
              <Select value={f[fd.k] === false ? '0' : '1'} onChange={(e) => set(fd.k, e.target.value === '1')}>
                <option value="1">Sí</option><option value="0">No (apagado temporalmente)</option>
              </Select>
            ) : (
              <Input value={f[fd.k] ?? ''} disabled={fd.disabled} onChange={(e) => set(fd.k, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {onDelete && <Btn variant="danger" className="mr-auto" onClick={onDelete} disabled={busy}><Trash2 className="w-4 h-4" /> Eliminar</Btn>}
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={() => onSubmit(f)} busy={busy}>Revisar cambios</Btn>
      </div>
    </Modal>
  );
}

function ListTab({ rows, estado, setEstado, head, renderRow, newLabel, onNew, info }) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Estado">
          <Select value={estado} onChange={(e) => setEstado(e.target.value)}><option>FL</option><option>TX</option></Select>
        </Field>
        <div className="flex-1" />
        {onNew && <Btn onClick={onNew}><Plus className="w-4 h-4" /> {newLabel}</Btn>}
      </div>
      {info}
      {rows.length === 0 ? <Empty>Sin registros.</Empty> : <Table head={[...head, '']}>{rows.map(renderRow)}</Table>}
    </Card>
  );
}

const EditBtn = ({ onClick }) => (
  <button onClick={onClick} className="text-amber-400 hover:text-amber-300" title="Editar"><Pencil className="w-4 h-4" /></button>
);

// ── Zonas ────────────────────────────────────────────────────────────────────
export function ZonesTab({ data, flow }) {
  const [estado, setEstado] = useState('FL');
  const [editing, setEditing] = useState(undefined);
  const counts = useMemo(() => {
    const m = {};
    for (const r of data.routes) if (r.activo !== false) m[`${r.estado}|${r.zona}`] = (m[`${r.estado}|${r.zona}`] || 0) + 1;
    return m;
  }, [data.routes]);
  const rows = data.zones.filter((z) => z.estado === estado);
  const submit = async (f) => {
    const data = { descripcion: f.descripcion || '', activo: f.activo !== false, ...(editing ? {} : { estado, zona: (f.zona || '').trim() }) };
    if (await flow.review('RateZone', [{ key: editing?.zone_key ?? null, data }])) setEditing(undefined);
  };
  return (
    <>
      <ListTab rows={rows} estado={estado} setEstado={setEstado} newLabel="Nueva zona" onNew={() => setEditing(null)}
        info={<p className="text-xs text-white/40">Las zonas agrupan rutas. Para mover una ruta de zona, edítala en la pestaña Rutas.</p>}
        head={['Zona', 'Rutas activas', 'Descripción', 'Estado']}
        renderRow={(z) => (
          <tr key={z.id} className={z.activo === false ? 'opacity-40' : ''}>
            <Td className="text-white">{z.zona}</Td>
            <Td>{counts[`${z.estado}|${z.zona}`] || 0}</Td>
            <Td>{z.descripcion || '—'}</Td>
            <Td>{z.activo === false ? <Badge tone="red">inactiva</Badge> : <Badge tone="green">activa</Badge>}</Td>
            <Td><EditBtn onClick={() => setEditing(z)} /></Td>
          </tr>
        )} />
      {editing !== undefined && (
        <GenericEditor title={editing ? `Zona ${editing.zona}` : `Nueva zona (${estado})`} busy={flow.busy} error={flow.error}
          initial={{ zona: editing?.zona || '', descripcion: editing?.descripcion || '', activo: editing?.activo !== false }}
          fields={[
            { k: 'zona', label: 'Nombre', disabled: !!editing, hint: editing ? 'El nombre no se cambia: las rutas lo usan.' : undefined },
            { k: 'descripcion', label: 'Descripción', type: 'textarea' },
            { k: 'activo', label: 'Activa', type: 'bool' },
          ]}
          onClose={() => { setEditing(undefined); flow.setError(null); }} onSubmit={submit}
          onDelete={editing ? async () => { if (await flow.review('RateZone', [{ key: editing.zone_key, eliminar: true }])) setEditing(undefined); } : undefined} />
      )}
    </>
  );
}

// ── Cargos adicionales (accesoriales) ────────────────────────────────────────
// Los cargos principales siempre visibles con su monto editable; el resto en un
// menú desplegable con una caja al lado para su valor, para no saturar el panel.
// Los montos se guardan todos juntos con "Revisar cambios".
const PRINCIPALES = [
  { id: 'prepull', test: /pre-?pull/i },
  { id: 'hazmat', test: /hazmat/i },
  { id: 'detention', test: /waiting|espera|detenci|detention/i },
  { id: 'overweight', test: /overweight|sobrepeso/i },
];
const esPrincipal = (a) => PRINCIPALES.some((p) => p.test.test(a.concepto || ''));
const etiqueta = (a) => (/^waiting time$/i.test(a.concepto) ? 'Detention / Waiting Time' : a.concepto);
// El monto viene como texto con su unidad ("$100 · por contenedor", "$75 · por hora").
// En el campo solo se edita el valor; la unidad se conserva tal cual al guardar
// (el chat recibe exactamente el mismo texto). "por contenedor" no se muestra
// porque es lo normal en drayage; otras unidades (por hora, por pierna...) sí.
function splitMonto(monto) {
  const parts = String(monto || '').split(' · ');
  const i = parts.findIndex((p) => /\d|cotizar|incluido/i.test(p));
  return i < 0 ? { parts: [String(monto || '')], i: 0 } : { parts, i };
}
// "cotizar" (sin monto fijo) se muestra como caja vacía con "$..."; si se escribe
// un valor, reemplaza a "cotizar" y se conserva la unidad.
const valorDe = (monto) => { const s = splitMonto(monto); const v = s.parts[s.i]; return /^cotizar$/i.test(v.trim()) ? '' : v; };
const unidadDe = (monto) => { const s = splitMonto(monto); return s.parts.filter((_, j) => j !== s.i).join(' · '); };
const conValor = (monto, v) => {
  const s = splitMonto(monto);
  // "Por contenedor · cotizar" + "$300" → "$300 · por contenedor" (el valor primero, como los demás).
  if (/^cotizar$/i.test(s.parts[s.i].trim())) {
    const resto = s.parts.filter((_, j) => j !== s.i).map((u) => u.charAt(0).toLowerCase() + u.slice(1));
    return [v.trim(), ...resto].join(' · ');
  }
  const parts = [...s.parts]; parts[s.i] = v.trim(); return parts.join(' · ');
};
const unidadVisible = (monto) => { const u = unidadDe(monto); return /^por contenedor$/i.test(u.trim()) ? '' : u; };

const montoCls = 'w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-sm text-white font-mono focus:outline-none focus:border-amber-500/50';

export function AccessorialsTab({ data, flow }) {
  const [estado, setEstado] = useState('FL');
  const [editing, setEditing] = useState(undefined);
  const [draft, setDraft] = useState({});          // accessorial_key → monto editado
  const [otro, setOtro] = useState('');

  const rows = useMemo(() => data.accessorials.filter((a) => a.estado === estado), [data.accessorials, estado]);
  const principales = useMemo(() => PRINCIPALES.flatMap((p) => rows.filter((a) => p.test.test(a.concepto || ''))), [rows]);
  const otros = useMemo(() => rows.filter((a) => !esPrincipal(a)), [rows]);
  const sel = otros.find((a) => a.accessorial_key === otro) || otros[0];

  // Al recargar los datos (después de guardar) o cambiar de estado, se limpian los borradores.
  // Al guardar (los datos se recargan) la caja de "otros cargos" conserva el valor
  // guardado en vez de quedar vacía. Al cambiar de estado se limpia todo.
  const enviado = useRef({});
  const [guardado, setGuardado] = useState({});
  useEffect(() => {
    // Solo lo que de verdad quedó guardado (si se canceló la revisión, no se muestra).
    const ok = Object.fromEntries(Object.entries(enviado.current).filter(([k, v]) =>
      data.accessorials.some((a) => a.accessorial_key === k && valorDe(a.monto).trim() === v)));
    setGuardado((g) => ({ ...g, ...ok }));
    enviado.current = {};
    setDraft({});
  }, [data.accessorials]);
  useEffect(() => { setDraft({}); setGuardado({}); enviado.current = {}; }, [estado]);

  // draft guarda solo el VALOR editado; al guardar se vuelve a unir con su unidad.
  const valor = (a) => (a.accessorial_key in draft ? draft[a.accessorial_key] : valorDe(a.monto));
  const cambiar = (a, v) => setDraft((d) => ({ ...d, [a.accessorial_key]: v }));
  // Una caja vacía no es un cambio (no se borra un monto por accidente).
  const cambios = rows.filter((a) => a.accessorial_key in draft && draft[a.accessorial_key].trim() !== '' && draft[a.accessorial_key].trim() !== valorDe(a.monto).trim());

  // Un número solo ("410") se guarda con signo de dólar ("$410").
  const conDolar = (v) => (/^\d[\d,.]*$/.test(v.trim()) ? `$${v.trim()}` : v.trim());
  const revisar = () => {
    enviado.current = Object.fromEntries(cambios.map((a) => [a.accessorial_key, conDolar(draft[a.accessorial_key])]));
    return flow.review('RateAccessorial', cambios.map((a) => ({ key: a.accessorial_key, data: { monto: conValor(a.monto, conDolar(draft[a.accessorial_key])) } })));
  };
  const submit = async (f) => {
    const d = { concepto: (f.concepto || '').trim(), gatillo: f.gatillo || null, monto: (f.monto || '').trim(), nota: f.nota || null, activo: f.activo !== false, ...(editing ? {} : { estado }) };
    if (await flow.review('RateAccessorial', [{ key: editing?.accessorial_key ?? null, data: d }])) setEditing(undefined);
  };
  const corto = (s) => (s && s.length > 45 ? `${s.slice(0, 45)}…` : s);

  return (
    <>
      <Card className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Estado">
            <Select value={estado} onChange={(e) => { setEstado(e.target.value); setOtro(''); }}><option>FL</option><option>TX</option></Select>
          </Field>
          <div className="flex-1" />
          <Btn variant="ghost" onClick={() => setEditing(null)}><Plus className="w-4 h-4" /> Nuevo cargo</Btn>
        </div>
        <p className="text-xs text-white/40">Cargos que se suman a la tarifa de la ruta cuando pasa algo especial. El chat los usa para todos los usuarios; también se actualizan con la hoja de accesoriales del Excel.</p>

        {principales.length === 0 ? <Empty>Sin cargos principales en {estado}.</Empty> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {principales.map((a) => (
              <div key={a.accessorial_key} className={a.activo === false ? 'opacity-50' : ''}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/70">
                    {etiqueta(a)}{unidadVisible(a.monto) && <span className="text-white/40 font-normal"> · {unidadVisible(a.monto)}</span>}
                    {a.activo === false && <> <Badge tone="red">apagado</Badge></>}
                  </span>
                  <EditBtn onClick={() => setEditing(a)} />
                </div>
                <input className={montoCls} value={valor(a)} placeholder="$..." onChange={(e) => cambiar(a, e.target.value)} />
                {a.gatillo && <span className="block text-[11px] text-white/40 mt-1">{a.gatillo}</span>}
              </div>
            ))}
          </div>
        )}

        {otros.length > 0 && (
          <div className="pt-4 border-t border-white/10 space-y-2">
            <span className="block text-xs font-medium text-white/60">Otros cargos adicionales</span>
            {/* Dos columnas iguales y fijas: el ancho no cambia al elegir otro cargo. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select className="min-w-0 truncate" value={sel?.accessorial_key || ''} onChange={(e) => setOtro(e.target.value)}>
                {otros.map((a) => (
                  <option key={a.accessorial_key} value={a.accessorial_key}>
                    {a.concepto}{otros.filter((x) => x.concepto === a.concepto).length > 1 && a.gatillo ? ` · ${corto(a.gatillo)}` : ''}{a.activo === false ? ' (apagado)' : ''}
                  </option>
                ))}
              </Select>
              {/* La caja arranca vacía ($...): solo se escribe el valor nuevo. */}
              {sel && (
                <input className={`${montoCls} min-w-0`} value={draft[sel.accessorial_key] ?? guardado[sel.accessorial_key] ?? ''} placeholder="$..." onChange={(e) => cambiar(sel, e.target.value)} />
              )}
            </div>
            {sel && (
              <div className="flex items-start gap-2 text-[11px] text-white/40">
                <span className="flex-1">
                  <span className="text-white/70">Valor actual: {valorDe(sel.monto) || 'cotizar'}{unidadVisible(sel.monto) ? ` ${unidadVisible(sel.monto)}` : ''}</span>
                  {sel.gatillo ? ` · ${sel.gatillo}` : ''}{sel.nota ? ` · ${sel.nota}` : ''}
                </span>
                <button type="button" onClick={() => setEditing(sel)} className="text-amber-400 hover:text-amber-300 whitespace-nowrap">Editar detalles</button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          {cambios.length > 0 && <span className="text-xs text-white/50">{cambios.length} {cambios.length === 1 ? 'monto modificado' : 'montos modificados'}</span>}
          {cambios.length > 0 && <Btn variant="ghost" onClick={() => setDraft({})}>Descartar</Btn>}
          <Btn onClick={revisar} busy={flow.busy} disabled={cambios.length === 0}>Revisar cambios</Btn>
        </div>
        <ErrorBox error={editing === undefined ? flow.error : null} />
      </Card>

      {editing !== undefined && (
        <GenericEditor title={editing ? `Cargo · ${etiqueta(editing)}` : `Nuevo cargo adicional (${estado})`} busy={flow.busy} error={flow.error}
          initial={{ concepto: editing?.concepto || '', monto: editing?.monto || '', gatillo: editing?.gatillo || '', nota: editing?.nota || '', activo: editing?.activo !== false }}
          fields={[
            { k: 'concepto', label: 'Cargo' },
            { k: 'monto', label: 'Monto', hint: 'Tal como lo verá el chat, ej: $100 · por contenedor' },
            { k: 'gatillo', label: 'Cuándo aplica', type: 'textarea' },
            { k: 'nota', label: 'Nota', type: 'textarea' },
            { k: 'activo', label: 'Activo', type: 'bool' },
          ]}
          onClose={() => { setEditing(undefined); flow.setError(null); }} onSubmit={submit}
          onDelete={editing ? async () => { if (await flow.review('RateAccessorial', [{ key: editing.accessorial_key, eliminar: true }])) setEditing(undefined); } : undefined} />
      )}
    </>
  );
}
