// F3-15 · Fase 6 — Privacidad y datos: documentos legales, descargar mis datos y
// solicitar la eliminación de la cuenta (no borra nada al instante: soporte la revisa).
import React, { useEffect, useState } from 'react';
import { FileText, ShieldCheck, Download, Trash2, Loader2, CheckCircle2, ExternalLink, AlertTriangle, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useAppState } from '@/lib/AppStateContext';
import { downloadMyData } from '@/lib/exportMyData';
import { legalUrl, SUPPORT_EMAIL } from '@/lib/support';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

function Block({ title, desc, children }) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

const fecha = (iso, locale) => { try { return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-US', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; } };

export default function PrivacySection({ locale }) {
  const { user } = useAuth();
  const { organization } = useAppState();
  const email = String(user?.email || '').toLowerCase();
  const [exportando, setExportando] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [solicitud, setSolicitud] = useState(undefined); // undefined = cargando
  const [abrir, setAbrir] = useState(false);

  useEffect(() => {
    let active = true;
    base44.functions.invoke('requestAccountDeletion', { accion: 'estado' })
      .then((r) => { if (active) setSolicitud(r?.data?.solicitud || null); })
      .catch(() => { if (active) setSolicitud(null); });
    return () => { active = false; };
  }, []);

  const descargar = async () => {
    setExportando(true); setExportMsg(null);
    try {
      await downloadMyData({ base44, email, organization });
      setExportMsg({ ok: true, msg: tx(locale, 'Archivo descargado.', 'File downloaded.') });
    } catch {
      setExportMsg({ ok: false, msg: tx(locale, 'No se pudo generar el archivo. Intenta de nuevo.', 'The file could not be created. Please try again.') });
    } finally { setExportando(false); }
  };

  const docs = [
    { id: 'terms', icon: FileText, label: tx(locale, 'Términos y condiciones', 'Terms and conditions') },
    { id: 'privacy', icon: ShieldCheck, label: tx(locale, 'Política de privacidad', 'Privacy policy') },
  ];

  return (
    <div className="space-y-5">
      <Block title={tx(locale, 'Documentos legales', 'Legal documents')} desc={tx(locale, 'Las condiciones de uso de Trucky y cómo cuidamos tus datos.', 'Trucky terms of use and how we protect your data.')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docs.map(({ id, icon: Icon, label }) => (
            <a key={id} href={legalUrl(id, locale)} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors">
              <span className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" /> {label}</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
          ))}
        </div>
      </Block>

      <Block title={tx(locale, 'Descargar mis datos', 'Download my data')}
        desc={tx(locale, 'Un archivo con tu perfil, costos, plantillas y los datos de tu empresa: cargas, brokers, flota y conductores. No incluye tus correos ni el chat.',
          'A file with your profile, costs, templates and your company data: loads, brokers, fleet and drivers. It does not include your emails or the chat.')}>
        <div className="flex items-center justify-end gap-3">
          {exportMsg && <span className={`text-sm flex items-center gap-1 ${exportMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{exportMsg.ok && <CheckCircle2 className="w-4 h-4" />}{exportMsg.msg}</span>}
          <button type="button" onClick={descargar} disabled={exportando}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {tx(locale, 'Descargar (.json)', 'Download (.json)')}
          </button>
        </div>
      </Block>

      <Block title={tx(locale, 'Eliminar mi cuenta', 'Delete my account')}
        desc={tx(locale, `Envías una solicitud a soporte (${SUPPORT_EMAIL}). Te contactaremos para confirmarla antes de borrar tu cuenta y los datos de tu empresa.`,
          `You send a request to support (${SUPPORT_EMAIL}). We will contact you to confirm it before deleting your account and your company data.`)}>
        {solicitud === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Cargando…', 'Loading…')}</div>
        ) : solicitud ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300 flex gap-2">
            <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{tx(locale, `Solicitud enviada el ${fecha(solicitud.solicitado_at, locale)}. Soporte te contactará para confirmarla. Si cambiaste de opinión, escríbenos a ${SUPPORT_EMAIL}.`,
              `Request sent on ${fecha(solicitud.solicitado_at, locale)}. Support will contact you to confirm it. If you changed your mind, write to ${SUPPORT_EMAIL}.`)}</span>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => setAbrir(true)}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10">
              <Trash2 className="w-4 h-4" /> {tx(locale, 'Solicitar eliminación de cuenta', 'Request account deletion')}
            </button>
          </div>
        )}
      </Block>

      {abrir && <ConfirmDelete locale={locale} onClose={() => setAbrir(false)} onDone={(s) => { setSolicitud(s); setAbrir(false); }} />}
    </div>
  );
}

function ConfirmDelete({ locale, onClose, onDone }) {
  const palabra = locale === 'en' ? 'DELETE' : 'ELIMINAR';
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listo = texto.trim().toUpperCase() === palabra;

  const enviar = async () => {
    setBusy(true); setError('');
    try {
      const r = await base44.functions.invoke('requestAccountDeletion', { confirmacion: texto.trim(), motivo });
      onDone(r?.data?.solicitud || { estado: 'pendiente', solicitado_at: new Date().toISOString() });
    } catch {
      setError(tx(locale, `No se pudo enviar la solicitud. Escríbenos a ${SUPPORT_EMAIL}.`, `The request could not be sent. Write to us at ${SUPPORT_EMAIL}.`));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">{tx(locale, '¿Solicitar la eliminación de tu cuenta?', 'Request deleting your account?')}</h3>
            <p className="text-sm text-muted-foreground">{tx(locale,
              'Cuando soporte la confirme se borrarán tu cuenta, tu perfil y los datos de tu empresa (cargas, brokers, flota, conductores y plantillas). Si tienes un plan pagado, primero cancélalo en Mi plan.',
              'Once support confirms it, your account, profile and company data (loads, brokers, fleet, drivers and templates) will be deleted. If you have a paid plan, cancel it first in My plan.')}</p>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{tx(locale, 'Motivo (opcional)', 'Reason (optional)')}</span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 500))} rows={2}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 resize-none" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{tx(locale, `Escribe ${palabra} para confirmar`, `Type ${palabra} to confirm`)}</span>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60" />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">{tx(locale, 'Cancelar', 'Cancel')}</button>
          <button type="button" onClick={enviar} disabled={!listo || busy}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {tx(locale, 'Enviar solicitud', 'Send request')}
          </button>
        </div>
      </div>
    </div>
  );
}
