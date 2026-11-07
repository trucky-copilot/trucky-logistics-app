import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { peekBillingLinkCode, clearBillingLinkCode } from '@/lib/billingLinkCapture';

const MESSAGES = {
  LINK_EXPIRED: 'El enlace venció o ya se usó. Solicita uno nuevo desde la web.',
  LINK_ALREADY_USED: 'Este enlace ya se usó. Solicita uno nuevo desde la web.',
  IDENTITY_MISMATCH: 'La sesión de Trucky no corresponde a la cuenta de la web. Entra con la misma cuenta y solicita un enlace nuevo.',
  IDENTITY_ALREADY_BOUND: 'Esta cuenta ya está vinculada a otro usuario. Contacta a soporte.',
  VERIFIED_MEMBERSHIP_REQUIRED: 'No encontramos una membresía verificada para esta empresa. Contacta a soporte.',
  NATIVE_SESSION_REQUIRED: 'Inicia sesión en Trucky y solicita de nuevo la vinculación.',
  LINK_NOT_ENABLED: 'La vinculación no está habilitada en este momento.',
  PILOT_NOT_ALLOWED: 'Esta cuenta no forma parte del piloto de vinculación.',
  PILOT_NOT_CONFIGURED: 'La vinculación no está habilitada en este momento.',
  NO_PENDING_LINK: 'No hay una vinculación pendiente para esta sesión. Contacta a soporte.',
};
// La identidad ya quedó verificada y reservada; solo falta guardarla en la cuenta.
// No se pide otro enlace: se reintenta la finalización con la misma sesión.
const PENDING = 'Tu identidad quedó verificada, pero no pudimos terminar de guardar la vinculación. Pulsa "Reintentar" en unos segundos; no hace falta un enlace nuevo.';
const GENERIC = 'No se pudo vincular. Solicita un enlace nuevo desde la web; no se ha concedido acceso.';

export default function BillingLinkConfirmation() {
  const [code, setCode] = useState(peekBillingLinkCode);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!code) return;
    base44.auth.me()
      .then((user) => setEmail(user?.email || ''))
      .catch(() => setMessage(MESSAGES.NATIVE_SESSION_REQUIRED));
  }, [code]);

  const close = () => { clearBillingLinkCode(); setCode(null); };

  async function run(payload) {
    setBusy(true);
    setMessage('');
    try {
      const response = await base44.functions.invoke('redeemBillingLink', payload);
      const result = response?.data?.code;
      if (result !== 'IDENTITY_LINKED') throw Object.assign(new Error('LINK_FAILED'), { result });
      clearBillingLinkCode();
      setCode(null);
      window.location.reload();
    } catch (err) {
      const result = err?.result || err?.response?.data?.code;
      if (result === 'LINK_COMPLETION_PENDING') {
        // El código ya se consumió en el servidor: desde aquí solo se reintenta la finalización.
        clearBillingLinkCode();
        setPending(true);
        setMessage(PENDING);
      } else {
        setMessage(MESSAGES[result] || GENERIC);
      }
      setBusy(false);
    }
  }

  const confirm = () => run(pending ? { resume: true, confirm: true } : { code, confirm: true });

  if (!code) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="billing-link-title"
      className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4">
      <section className="bg-card text-foreground border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
        <h2 id="billing-link-title" className="text-lg font-semibold">Vincular cuenta de facturación</h2>
        <p className="text-sm text-muted-foreground">
          Confirma que deseas vincular la cuenta de la web con tu sesión actual de Trucky:{' '}
          <span className="font-medium text-foreground">{email || 'sin sesión verificada'}</span>.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={close} disabled={busy}
            className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={busy || !email}
            className="flex-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            {busy ? 'Vinculando…' : pending ? 'Reintentar' : 'Confirmar vinculación'}
          </button>
        </div>
        {message && <p role="alert" className={`text-xs ${pending ? 'text-amber-400' : 'text-destructive'}`}>{message}</p>}
      </section>
    </div>
  );
}
