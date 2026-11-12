// F3-15 · Fase 2 — Perfil personal: nombre, teléfono, MC y DOT (se guardan en
// el UserProfile propio; Base44 solo deja leer/editar el registro del mismo
// usuario). Cambiar correo queda inhabilitado (limitación de Base44) y la
// contraseña solo aplica a cuentas con correo y contraseña (no Google).
import React, { useEffect, useState } from 'react';
import { Loader2, Lock, Save, CheckCircle2, ExternalLink, KeyRound, Mail } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useAppState } from '@/lib/AppStateContext';
import { normalizeProfile, validateProfile } from '@/lib/profileValidation';

const tx = (locale, es, en) => (locale === 'en' ? en : es);
const inputCls = 'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 disabled:opacity-50';

function Field({ label, hint, error, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-400">{error}</span> : hint ? <span className="block text-[11px] text-muted-foreground/70">{hint}</span> : null}
    </label>
  );
}

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

export default function PersonalSection({ locale }) {
  const { user } = useAuth();
  const { userProfile, organization } = useAppState();
  const email = String(user?.email || '').toLowerCase();

  const [record, setRecord] = useState(null);       // UserProfile propio
  const [carrier, setCarrier] = useState(null);     // CarrierProfile de la empresa (si es carrier)
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);       // { ok: boolean, msg }

  useEffect(() => {
    let active = true;
    if (!email) return;
    (async () => {
      const rows = await base44.entities.UserProfile.filter({ usuario: email }).catch(() => []);
      const rec = rows?.[0] || null;
      let cp = null;
      if (organization?.id) {
        const cps = await base44.entities.CarrierProfile.filter({ organization_id: organization.id }).catch(() => []);
        cp = cps?.[0] || null;
      }
      if (!active) return;
      setRecord(rec);
      setCarrier(cp);
      setForm({
        nombre_completo: rec?.nombre_completo || user?.full_name || '',
        telefono: rec?.telefono || '',
        mc_number: rec?.mc_number || cp?.mc_number || '',
        dot_number: rec?.dot_number || cp?.dot_number || '',
      });
    })();
    return () => { active = false; };
  }, [email, organization?.id]);

  const set = (k, v) => { setStatus(null); setErrors((e) => ({ ...e, [k]: undefined })); setForm((f) => ({ ...f, [k]: v })); };

  const guardar = async (ev) => {
    ev.preventDefault();
    const data = normalizeProfile(form);
    const errs = validateProfile(data, locale);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setStatus(null);
    try {
      if (record) await base44.entities.UserProfile.update(record.id, data);
      else setRecord(await base44.entities.UserProfile.create({ usuario: email, ...data }));
      // Nombre visible en la cuenta (mejor esfuerzo: si la plataforma no lo permite, queda en el perfil).
      try { await base44.auth.updateMe({ full_name: data.nombre_completo }); } catch { /* sin efecto */ }
      // Carriers: el MC/DOT también es el de su empresa (lo usa la firma de los correos).
      const esCarrier = (userProfile?.rol || record?.rol) === 'carrier';
      if (esCarrier && carrier) {
        try { await base44.entities.CarrierProfile.update(carrier.id, { mc_number: data.mc_number || null, dot_number: data.dot_number || null }); } catch { /* sin permiso: queda en el perfil */ }
      }
      setForm(data);
      setStatus({ ok: true, msg: tx(locale, 'Cambios guardados.', 'Changes saved.') });
    } catch {
      setStatus({ ok: false, msg: tx(locale, 'No se pudieron guardar los cambios. Intenta de nuevo.', 'Changes could not be saved. Please try again.') });
    } finally { setSaving(false); }
  };

  if (!form) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Cargando…', 'Loading…')}</div>;

  return (
    <div className="space-y-5">
      <Block title={tx(locale, 'Datos personales', 'Personal details')} desc={tx(locale, 'Se usan en tu cuenta y en la firma de tus correos.', 'Used in your account and in your email signature.')}>
        <form onSubmit={guardar} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={tx(locale, 'Nombre completo', 'Full name')} error={errors.nombre_completo}>
              <input className={inputCls} value={form.nombre_completo} onChange={(e) => set('nombre_completo', e.target.value)} autoComplete="name" />
            </Field>
            <Field label={tx(locale, 'Teléfono', 'Phone')} hint={tx(locale, 'Ej. +1 305 555 0101', 'E.g. +1 305 555 0101')} error={errors.telefono}>
              <input className={inputCls} value={form.telefono} onChange={(e) => set('telefono', e.target.value)} autoComplete="tel" inputMode="tel" />
            </Field>
            <Field label="MC" hint={tx(locale, 'Solo números.', 'Numbers only.')} error={errors.mc_number}>
              <input className={inputCls} value={form.mc_number} onChange={(e) => set('mc_number', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="DOT" hint={tx(locale, 'Solo números.', 'Numbers only.')} error={errors.dot_number}>
              <input className={inputCls} value={form.dot_number} onChange={(e) => set('dot_number', e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-3">
            {status && <span className={`text-sm flex items-center gap-1 ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.ok && <CheckCircle2 className="w-4 h-4" />}{status.msg}</span>}
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {tx(locale, 'Guardar', 'Save')}
            </button>
          </div>
        </form>
      </Block>

      <Block title={tx(locale, 'Correo de la cuenta', 'Account email')}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 flex items-center gap-2 text-sm text-foreground"><Mail className="w-4 h-4 text-muted-foreground" /> {email}</div>
          <button type="button" disabled className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground opacity-60 cursor-not-allowed">
            <Lock className="w-3.5 h-3.5" /> {tx(locale, 'Cambiar correo · Próximamente', 'Change email · Coming soon')}
          </button>
        </div>
      </Block>

      <PasswordBlock locale={locale} userId={user?.id} />
    </div>
  );
}

function PasswordBlock({ locale, userId }) {
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const set = (k, v) => { setStatus(null); setF((s) => ({ ...s, [k]: v })); };

  const cambiar = async (ev) => {
    ev.preventDefault();
    if (f.nueva.length < 8) return setStatus({ ok: false, msg: tx(locale, 'La nueva contraseña debe tener al menos 8 caracteres.', 'The new password must have at least 8 characters.') });
    if (f.nueva !== f.repetir) return setStatus({ ok: false, msg: tx(locale, 'Las contraseñas nuevas no coinciden.', 'The new passwords do not match.') });
    setBusy(true); setStatus(null);
    try {
      await base44.auth.changePassword({ userId, currentPassword: f.actual, newPassword: f.nueva });
      setF({ actual: '', nueva: '', repetir: '' });
      setStatus({ ok: true, msg: tx(locale, 'Contraseña actualizada.', 'Password updated.') });
    } catch {
      setStatus({ ok: false, msg: tx(locale, 'No se pudo cambiar. Revisa tu contraseña actual. Si entras con Google, tu contraseña se cambia en tu cuenta de Google.', 'Could not change it. Check your current password. If you sign in with Google, change your password in your Google account.') });
    } finally { setBusy(false); }
  };

  return (
    <Block title={tx(locale, 'Contraseña', 'Password')} desc={tx(locale, 'Solo para cuentas que entran con correo y contraseña.', 'Only for accounts that sign in with email and password.')}>
      <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          {tx(locale, 'Si entras con Google, no tienes contraseña en Trucky: se cambia en tu cuenta de Google.', 'If you sign in with Google, you have no Trucky password: change it in your Google account.')}{' '}
          <a href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
            {tx(locale, 'Abrir cuenta de Google', 'Open Google account')} <ExternalLink className="w-3 h-3" />
          </a>
        </span>
      </div>
      <form onSubmit={cambiar} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={tx(locale, 'Contraseña actual', 'Current password')}>
            <input type="password" className={inputCls} value={f.actual} onChange={(e) => set('actual', e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={tx(locale, 'Nueva contraseña', 'New password')} hint={tx(locale, 'Mínimo 8 caracteres.', 'At least 8 characters.')}>
            <input type="password" className={inputCls} value={f.nueva} onChange={(e) => set('nueva', e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label={tx(locale, 'Repetir nueva contraseña', 'Repeat new password')}>
            <input type="password" className={inputCls} value={f.repetir} onChange={(e) => set('repetir', e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3">
          {status && <span className={`text-sm ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>}
          <button type="submit" disabled={busy || !f.actual || !f.nueva} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {tx(locale, 'Cambiar contraseña', 'Change password')}
          </button>
        </div>
      </form>
    </Block>
  );
}
