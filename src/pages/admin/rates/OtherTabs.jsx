// Pestañas Cargar Excel, Historial y Migración.
import React, { useEffect, useState } from 'react';
import { Upload, RefreshCw } from 'lucide-react';
import { Card, Btn, Field, Select, Badge, ErrorBox, Empty, Table, Td } from './ui';
import ChangePreview, { fmt } from './ChangePreview';
import { previewExcel, applyExcel, fileToBase64, loadHistory, migrateRates } from '@/lib/ratesApi';

const MAX_MB = 5;

// ── Cargar Excel ─────────────────────────────────────────────────────────────
// El archivo se procesa en el servidor con el MISMO conversor que generó las
// tablas originales. Primero muestra la vista previa; nada se guarda sin confirmar.
export function ExcelTab({ onSaved }) {
  const [estado, setEstado] = useState('FL');
  const [file, setFile] = useState(null);
  const [eliminarFaltantes, setEliminarFaltantes] = useState(false);
  const [preview, setPreview] = useState(null);
  const [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const revisar = async () => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { setError(`El archivo supera ${MAX_MB} MB.`); return; }
    setBusy(true); setError(null);
    try {
      const p = { estado, fileName: file.name, fileBase64: await fileToBase64(file), eliminarFaltantes };
      setPreview(await previewExcel(p));
      setPayload(p);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const confirmar = async () => {
    const res = await applyExcel({ ...payload, firma: preview?.firma });
    if (res?.errores?.length) throw new Error(res.errores.map((e) => e.mensaje).join('; '));
    setPreview(null); setPayload(null); setFile(null);
    await onSaved?.();
  };

  return (
    <Card className="space-y-4">
      <p className="text-sm text-white/60">
        Sube el Excel de tarifas drayage (mismo formato que <span className="text-white">Trucky_Rates_Drayage_FL / TX</span>).
        Cada ruta se reconoce por estado + ciudad + mercado + zona (no por el número de fila): las nuevas se crean, las que cambian se actualizan en el mismo registro (UPSERT) y las iguales no se tocan.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Estado del archivo">
          <Select value={estado} onChange={(e) => setEstado(e.target.value)}><option>FL</option><option>TX</option></Select>
        </Field>
        <Field label="Archivo (.xlsx)">
          <input type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }}
            className="text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white" />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-xs text-white/60">
        <input type="checkbox" className="mt-0.5" checked={eliminarFaltantes} onChange={(e) => setEliminarFaltantes(e.target.checked)} />
        <span>Eliminar las rutas y accesoriales de {estado} que <b>no</b> vienen en este archivo. Se listan en la revisión antes de confirmar y quedan registrados en el historial.</span>
      </label>
      <ErrorBox error={error} />
      <Btn onClick={revisar} busy={busy} disabled={!file}><Upload className="w-4 h-4" /> Revisar archivo</Btn>
      {preview && (
        <ChangePreview preview={preview} onConfirm={confirmar} onClose={() => setPreview(null)} />
      )}
    </Card>
  );
}

// ── Historial ────────────────────────────────────────────────────────────────
const ENT_LABEL = { RateRoute: 'Ruta', RateAccessorial: 'Accesorial', RateAlias: 'Alias', RateZone: 'Zona' };
const ACC_TONE = { crear: 'green', actualizar: 'amber', eliminar: 'red' };

export function HistoryTab({ reloadKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [entidad, setEntidad] = useState('');
  const [origen, setOrigen] = useState('');
  const [open, setOpen] = useState(null);

  const load = async () => {
    setError(null);
    try { setRows(await loadHistory(300)); } catch (e) { setError(e.message); setRows([]); }
  };
  useEffect(() => { load(); }, [reloadKey]);

  const list = (rows || []).filter((r) => (!entidad || r.entidad === entidad) && (!origen || r.origen === origen));
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tipo">
          <Select value={entidad} onChange={(e) => setEntidad(e.target.value)}>
            <option value="">Todos</option>{Object.entries(ENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Origen">
          <Select value={origen} onChange={(e) => setOrigen(e.target.value)}>
            <option value="">Todos</option><option value="manual">Manual</option><option value="excel">Excel</option><option value="migracion">Migración</option>
          </Select>
        </Field>
        <div className="flex-1" />
        <Btn variant="ghost" onClick={load}><RefreshCw className="w-4 h-4" /> Actualizar</Btn>
      </div>
      <ErrorBox error={error} />
      {rows === null ? <Empty>Cargando…</Empty> : list.length === 0 ? <Empty>Sin cambios registrados.</Empty> : (
        <Table head={['Fecha', 'Usuario', 'Tipo', 'Acción', 'Registro', 'Campos']}>
          {list.map((r) => (
            <React.Fragment key={r.id}>
              <tr className="cursor-pointer hover:bg-white/5" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <Td className="whitespace-nowrap">{r.created_date ? new Date(r.created_date).toLocaleString() : '—'}</Td>
                <Td>{r.usuario_email}</Td>
                <Td>{ENT_LABEL[r.entidad] || r.entidad} <span className="text-white/40 text-[11px]">· {r.origen}</span></Td>
                <Td><Badge tone={ACC_TONE[r.accion] || 'gray'}>{r.accion}</Badge></Td>
                <Td className="break-all text-xs">{r.registro_key}</Td>
                <Td className="text-xs">{(r.campos || []).join(', ') || '—'}</Td>
              </tr>
              {open === r.id && (
                <tr><td colSpan={6} className="bg-white/5 p-3 text-xs space-y-1">
                  {(r.campos?.length ? r.campos : Object.keys(r.despues || {})).map((c) => (
                    <div key={c} className="grid md:grid-cols-[120px_1fr] gap-1">
                      <span className="text-white/50">{c}</span>
                      <span><span className="text-red-300">{fmt(c, r.antes?.[c])}</span>{' → '}<span className="text-emerald-300">{fmt(c, r.despues?.[c])}</span></span>
                    </div>
                  ))}
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </Table>
      )}
    </Card>
  );
}

// ── Migración inicial ────────────────────────────────────────────────────────
export function MigrationTab({ data, onSaved }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const run = async (action) => {
    setBusy(action); setError(null);
    try {
      const r = await migrateRates(action);
      setResult(r);
      if (action === 'apply') await onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const vacia = data.routes.length === 0;
  return (
    <Card className="space-y-4">
      <p className="text-sm text-white/60">
        Copia UNA VEZ las tarifas que hoy usa el chat (archivos del sistema) a la base de datos. Mientras la base esté vacía el chat sigue usando esos archivos.
        Correrla de nuevo no pisa lo que se haya editado desde esta pantalla. El historial guarda los últimos 12 meses.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone={vacia ? 'amber' : 'green'}>{vacia ? 'Base vacía: el chat usa los archivos' : `En la base: ${data.routes.length} rutas`}</Badge>
        <Badge>Accesoriales: {data.accessorials.length}</Badge>
        <Badge>Alias: {data.aliases.length}</Badge>
        <Badge>Zonas: {data.zones.length}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn variant="ghost" busy={busy === 'preview'} onClick={() => run('preview')}>1 · Previsualizar</Btn>
        <Btn busy={busy === 'apply'} onClick={() => run('apply')}>2 · Migrar</Btn>
        <Btn variant="ghost" busy={busy === 'verify'} onClick={() => run('verify')}>3 · Verificar</Btn>
      </div>
      <ErrorBox error={error} />
      {result?.action === 'verify' && (
        <div className="space-y-2">
          {result.ok ? <Badge tone="green">✓ 0 diferencias: la base es idéntica a las tarifas actuales</Badge> : <Badge tone="red">Hay diferencias</Badge>}
          <pre className="text-xs text-white/70 bg-black/30 rounded-xl p-3 overflow-x-auto">{JSON.stringify({ conteos: result.counts, revision: result.checks, diferencias: result.diffs }, null, 2)}</pre>
        </div>
      )}
      {result?.resumen && (
        <Table head={['Tabla', 'Nuevas', 'Distintas a los archivos', 'Iguales', result.action === 'apply' ? 'Guardado' : '']}>
          {Object.entries(result.resumen).map(([k, v]) => (
            <tr key={k}>
              <Td className="text-white">{k}</Td><Td>{v.crear}</Td><Td>{v.cambiarian}</Td><Td>{v.iguales}</Td>
              <Td>{result.action === 'apply' ? <Badge tone="green">ok</Badge> : ''}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
