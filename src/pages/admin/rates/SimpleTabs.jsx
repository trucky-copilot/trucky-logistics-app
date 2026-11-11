// Pestaña Zonas (y el editor genérico que usa):
// lista filtrada por estado + editor con los campos definidos abajo.
import React, { useMemo, useState } from 'react';
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
