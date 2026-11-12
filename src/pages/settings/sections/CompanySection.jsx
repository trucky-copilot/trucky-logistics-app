// F3-15 · Fase 3 — Empresa y equipos: nombre de la empresa y tipos de camión.
// Todo pasa por la función updateCompanySettings (la organización solo la
// edita el servidor). Cambiar el nombre pide confirmación, porque el
// verificador de documentos (F4-07) compara contra él.
import React, { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, AlertTriangle, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAppState } from '@/lib/AppStateContext';

const tx = (locale, es, en) => (locale === 'en' ? en : es);
const inputCls = 'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 disabled:opacity-60';
const TRUCKS = [
  { id: 'dry_van', label: 'Dry Van' },
  { id: 'flatbed', label: 'Flatbed' },
  { id: 'reefer', label: 'Reefer' },
  { id: 'drayage', label: 'Drayage' },
];
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const errMsg = (e) => e?.response?.data?.error || e?.message || '';

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

function ConfirmName({ locale, anterior, nuevo, busy, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">{tx(locale, '¿Cambiar el nombre de la empresa?', 'Change the company name?')}</h3>
            <p className="text-sm text-muted-foreground">
              {tx(locale, 'El verificador de documentos compara tus documentos contra este nombre. Si no coincide con el de tus documentos, la verificación puede fallar.',
                'The document verifier compares your documents against this name. If it does not match your documents, verification may fail.')}
            </p>
            <div className="text-sm rounded-lg bg-background/60 border border-border p-3 space-y-1">
              <div><span className="text-muted-foreground">{tx(locale, 'Actual:', 'Current:')}</span> {anterior || '—'}</div>
              <div><span className="text-muted-foreground">{tx(locale, 'Nuevo:', 'New:')}</span> <b>{nuevo}</b></div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">{tx(locale, 'Cancelar', 'Cancel')}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {tx(locale, 'Aceptar', 'Accept')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompanySection({ locale }) {
  const { organization, organizationLoading, patchOrganization } = useAppState();
  const orgId = organization?.id || null;
  const [org, setOrg] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipos, setTipos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const apply = (o) => { setOrg(o); setNombre(o.name || ''); setTipos(o.tipos_camion || []); };

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    base44.functions.invoke('updateCompanySettings', { organization_id: orgId, accion: 'leer' })
      .then((res) => { if (!active) return; apply(res.data.organization); setCanEdit(!!res.data.puede_editar); })
      .catch((e) => { if (active) setLoadError({ status: e?.response?.status || e?.status || 'x', msg: e?.response?.data?.error || '' }); });
    return () => { active = false; };
  }, [orgId]);

  if (organizationLoading && !orgId) return <Loading locale={locale} />;
  if (!orgId) return <p className="text-sm text-muted-foreground">{tx(locale, 'Tu cuenta aún no tiene una empresa asociada.', 'Your account has no company yet.')}</p>;
  if (loadError) {
    // Si la función respondió, trae su propio motivo; un 404 sin motivo es que no está publicada.
    const why = loadError.msg ? `${loadError.msg} (${loadError.status})`
      : loadError.status === 404
      ? tx(locale, 'La función updateCompanySettings aún no está publicada en Base44.', 'The updateCompanySettings function is not published in Base44 yet.')
      : loadError.status === 403
        ? tx(locale, 'Tu usuario no figura como miembro activo de esta empresa.', 'Your user is not an active member of this company.')
        : tx(locale, `Error del servidor (${loadError.status}).`, `Server error (${loadError.status}).`);
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm space-y-1">
        <p className="text-red-400 font-medium">{tx(locale, 'No se pudieron cargar los datos de la empresa.', 'Company details could not be loaded.')}</p>
        <p className="text-muted-foreground">{why}</p>
      </div>
    );
  }
  if (!org) return <Loading locale={locale} />;

  const nombreCambia = clean(nombre) !== clean(org.name);
  const tiposCambian = [...tipos].sort().join() !== [...(org.tipos_camion || [])].sort().join();
  const hayCambios = nombreCambia || tiposCambian;

  // Un solo tipo de camión: elegir uno reemplaza al anterior.
  const toggle = (id) => { setStatus(null); setTipos([id]); };

  const enviar = async (confirmarNombre) => {
    setBusy(true); setStatus(null);
    try {
      const body = { organization_id: orgId, tipos_camion: tipos };
      if (nombreCambia) Object.assign(body, { nombre: clean(nombre), confirmar_nombre: confirmarNombre });
      const res = await base44.functions.invoke('updateCompanySettings', body);
      apply(res.data.organization);
      // El nuevo nombre se ve de inmediato en el resto de la app (Dashboard, etc.).
      patchOrganization?.({ name: res.data.organization.name, tipos_camion: res.data.organization.tipos_camion });
      setConfirmar(false);
      setStatus({ ok: true, msg: tx(locale, 'Cambios guardados.', 'Changes saved.') });
    } catch (e) {
      setConfirmar(false);
      setStatus({ ok: false, msg: errMsg(e) || tx(locale, 'No se pudieron guardar los cambios.', 'Changes could not be saved.') });
    } finally { setBusy(false); }
  };

  const guardar = (ev) => {
    ev.preventDefault();
    const n = clean(nombre);
    if (nombreCambia && (n.length < 2 || n.length > 120)) return setStatus({ ok: false, msg: tx(locale, 'El nombre debe tener entre 2 y 120 caracteres.', 'The name must have 2 to 120 characters.') });
    if (nombreCambia) return setConfirmar(true);
    enviar(false);
  };

  return (
    <div className="space-y-5">
      <form onSubmit={guardar} className="space-y-5" noValidate>
        <Block title={tx(locale, 'Nombre de la empresa', 'Company name')}
          desc={tx(locale, 'Debe coincidir con el de tus documentos: el verificador compara contra este nombre.', 'It must match your documents: the verifier compares against this name.')}>
          <input className={inputCls} value={nombre} disabled={!canEdit} onChange={(e) => { setStatus(null); setNombre(e.target.value); }} maxLength={120} />
          {!canEdit && <p className="text-xs text-muted-foreground">{tx(locale, 'Solo el dueño o un administrador de la empresa puede cambiar estos datos.', 'Only the company owner or an admin can change these details.')}</p>}
        </Block>

        <Block title={tx(locale, 'Tipo de camión', 'Truck type')} desc={tx(locale, 'Elige el equipo que maneja tu empresa (solo uno).', 'Choose the equipment your company runs (only one).')}>
          <div role="radiogroup" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TRUCKS.map((t) => {
              const on = tipos.includes(t.id);
              return (
                <button key={t.id} type="button" disabled={!canEdit} onClick={() => toggle(t.id)} role="radio" aria-checked={on}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}>
                  {t.label}{on && <Check className="w-4 h-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </Block>

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {status && <span className={`text-sm flex items-center gap-1 ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.ok && <CheckCircle2 className="w-4 h-4" />}{status.msg}</span>}
            <button type="submit" disabled={busy || !hayCambios} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {tx(locale, 'Guardar', 'Save')}
            </button>
          </div>
        )}
      </form>

      {confirmar && <ConfirmName locale={locale} anterior={org.name} nuevo={clean(nombre)} busy={busy} onCancel={() => setConfirmar(false)} onConfirm={() => enviar(true)} />}
    </div>
  );
}

function Loading({ locale }) {
  return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Cargando…', 'Loading…')}</div>;
}
