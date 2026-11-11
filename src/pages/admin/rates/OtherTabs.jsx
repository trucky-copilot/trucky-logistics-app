// Pestaña Cargar Excel.
import React, { useState } from 'react';
import { Upload } from 'lucide-react';
import { Card, Btn, Field, Select, ErrorBox } from './ui';
import ChangePreview from './ChangePreview';
import { previewExcel, applyExcel, fileToBase64 } from '@/lib/ratesApi';

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
        <span>Eliminar las rutas y accesoriales de {estado} que <b>no</b> vienen en este archivo. Se listan en la revisión antes de confirmar.</span>
      </label>
      <ErrorBox error={error} />
      <Btn onClick={revisar} busy={busy} disabled={!file}><Upload className="w-4 h-4" /> Revisar archivo</Btn>
      {preview && (
        <ChangePreview preview={preview} onConfirm={confirmar} onClose={() => setPreview(null)} />
      )}
    </Card>
  );
}
