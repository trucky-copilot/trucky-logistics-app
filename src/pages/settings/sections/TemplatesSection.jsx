// F3-15 · Fase 5 — Plantillas de correo propias. El usuario elige el escenario
// y sube su plantilla en un archivo .txt; se guarda en Base44 (EmailTemplate,
// que solo deja ver y editar las del mismo usuario). Las predeterminadas viven
// en el código (marketChat/plantillas_correo.json) y no se muestran aquí: el
// chat las usa en los escenarios donde el usuario no subió ninguna.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Trash2, FileText, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useAppState } from '@/lib/AppStateContext';
import officialTemplates from '../../../../base44/functions/marketChat/plantillas_correo.json';

const tx = (locale, es, en) => (locale === 'en' ? en : es);
// Solo los nombres de los escenarios (no el texto de las predeterminadas).
const SCENARIOS = officialTemplates.templates.map((t) => ({ id: t.id, name: t.name.replace(/^\d+\.\s*/, '') }));
const nameOf = (id) => SCENARIOS.find((s) => s.id === id)?.name || id;
const MAX_BODY = 5000;
const MAX_FILE = 50000;
const selectCls = 'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60';

async function readTxt(file, locale) {
  if (!file) return { error: '' };
  if (!/\.txt$/i.test(file.name)) return { error: tx(locale, 'Solo se aceptan archivos .txt.', 'Only .txt files are accepted.') };
  if (file.size > MAX_FILE) return { error: tx(locale, 'El archivo supera 50 KB.', 'The file is larger than 50 KB.') };
  const text = (await file.text()).replace(/\r\n/g, '\n').trim();
  if (!text) return { error: tx(locale, 'El archivo está vacío.', 'The file is empty.') };
  if (text.length > MAX_BODY) return { error: tx(locale, `La plantilla supera ${MAX_BODY} caracteres.`, `The template exceeds ${MAX_BODY} characters.`) };
  return { text };
}

export default function TemplatesSection({ locale }) {
  const { user } = useAuth();
  const { userProfile } = useAppState();
  const email = String(user?.email || '').toLowerCase();
  const [rows, setRows] = useState(null);
  const [escenario, setEscenario] = useState('');
  const [archivo, setArchivo] = useState(null);   // { name, text }
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!email) return;
    let active = true;
    base44.entities.EmailTemplate.filter({ usuario: email })
      .then((r) => { if (active) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [email]);

  if (!rows) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Cargando…', 'Loading…')}</div>;

  const propiaDe = (id) => rows.find((r) => r.escenario === id) || null;

  const elegirArchivo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setError(''); setAviso('');
    const r = await readTxt(f, locale);
    if (r.error) { setArchivo(null); setError(r.error); return; }
    if (r.text) setArchivo({ name: f.name, text: r.text });
  };

  const subir = async () => {
    if (!escenario || !archivo) return;
    setSaving(true); setError(''); setAviso('');
    try {
      const cur = propiaDe(escenario);
      const data = { cuerpo: archivo.text, asunto: '' };
      const saved = cur
        ? await base44.entities.EmailTemplate.update(cur.id, data)
        : await base44.entities.EmailTemplate.create({ usuario: email, escenario, ...data });
      const row = { ...(cur || {}), ...(saved || {}), ...data, escenario, usuario: email, archivo: archivo.name };
      setRows((rs) => [...rs.filter((r) => r.escenario !== escenario), row]);
      setAviso(tx(locale, `Plantilla subida para "${nameOf(escenario)}". El chat la usará en ese escenario.`, `Template uploaded for "${nameOf(escenario)}". The chat will use it for that scenario.`));
      setArchivo(null); setEscenario('');
    } catch {
      setError(tx(locale, 'No se pudo subir la plantilla. Intenta de nuevo.', 'The template could not be uploaded. Please try again.'));
    } finally { setSaving(false); }
  };

  const eliminar = async (id) => {
    setDeleting(id); setError(''); setAviso('');
    try {
      for (const r of rows.filter((x) => x.escenario === id)) await base44.entities.EmailTemplate.delete(r.id);
      setRows((rs) => rs.filter((r) => r.escenario !== id));
      setAviso(tx(locale, `Se eliminó tu plantilla de "${nameOf(id)}". El chat vuelve a usar la predeterminada.`, `Your "${nameOf(id)}" template was removed. The chat uses the default again.`));
    } catch {
      setError(tx(locale, 'No se pudo eliminar. Intenta de nuevo.', 'Could not remove it. Please try again.'));
    } finally { setDeleting(null); }
  };

  const reemplazar = (id) => { setEscenario(id); setArchivo(null); setError(''); setAviso(''); fileRef.current?.click(); };
  const mias = SCENARIOS.filter((s) => propiaDe(s.id));

  return (
    <div className="space-y-5">
      {userProfile?.rol === 'carrier' && (
        <p className="text-xs text-amber-300">{tx(locale, 'El chat redacta correos solo en cuentas de dispatcher.', 'The chat drafts emails only for dispatcher accounts.')}</p>
      )}

      <section className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Subir una plantilla', 'Upload a template')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{tx(locale, 'Elige el escenario y sube tu plantilla en un archivo .txt. En los escenarios donde no subas ninguna, el chat usa la predeterminada y te indica cuál usó.', 'Choose the scenario and upload your template as a .txt file. Where you upload none, the chat uses the default and tells you which one it used.')}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground flex gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{tx(locale, 'El chat redacta el correo en el idioma de la aplicación. Los campos entre corchetes, como [Broker name], [rate], [MC] o [Your name], los rellena con tus datos de Perfil personal y de la conversación.', 'The chat writes the email in the app language. Fields in brackets, like [Broker name], [rate], [MC] or [Your name], are filled in with your Personal profile and conversation data.')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{tx(locale, 'Escenario', 'Scenario')}</span>
            <select className={selectCls} style={{ colorScheme: 'dark' }} value={escenario} onChange={(e) => { setEscenario(e.target.value); setError(''); setAviso(''); }}>
              <option value="">{tx(locale, 'Elige un escenario…', 'Choose a scenario…')}</option>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}{propiaDe(s.id) ? ` · ${tx(locale, 'ya tiene la tuya', 'already yours')}` : ''}</option>)}
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">{tx(locale, 'Archivo (.txt)', 'File (.txt)')}</span>
            <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={elegirArchivo} />
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
              <FileText className="w-4 h-4" /> <span className="truncate">{archivo ? archivo.name : tx(locale, 'Seleccionar archivo .txt', 'Select .txt file')}</span>
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {aviso && <span className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {aviso}</span>}
          <button type="button" disabled={saving || !escenario || !archivo} onClick={subir}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {tx(locale, 'Subir plantilla', 'Upload template')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/60 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Mis plantillas', 'My templates')}</h3>
        {mias.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx(locale, 'Aún no has subido plantillas. El chat usa las predeterminadas.', 'You have not uploaded any templates yet. The chat uses the defaults.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {mias.map((s) => (
              <li key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="flex-1 text-sm text-foreground flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {s.name}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => reemplazar(s.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                    <RefreshCw className="w-3.5 h-3.5" /> {tx(locale, 'Reemplazar', 'Replace')}
                  </button>
                  <button type="button" disabled={deleting === s.id} onClick={() => eliminar(s.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                    {deleting === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} {tx(locale, 'Eliminar', 'Remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
