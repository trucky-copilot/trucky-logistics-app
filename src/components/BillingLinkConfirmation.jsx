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
};
const GENERIC = 'No se pudo vincular. Solicita un enlace nuevo desde la web; no se ha concedido acceso.';

export default function BillingLinkConfirmation() {
  const [code, setCode] = useState(peekBillingLinkCode);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    base44.auth.me()
      .then((user) => setEmail(user?.email || ''))
      .catch(() => setMessage(MESSAGES.NATIVE_SESSION_REQUIRED));
  }, [code]);

  const close = () => { clearBillingLinkCode(); setCode(null); };

  async function confirm() {
    setBusy(true);
    setMessage('');
    try {
      const response = await base44.functions.invoke('redeemBillingLink', { code, confirm: true });
      const result = response?.data?.code;
      if (result !== 'IDENTITY_LINKED') throw Object.assign(new Error('LINK_FAILED'), { result });
      clearBillingLinkCode();
      setCode(null);
      window.location.reload();
    } catch (err) {
      const result = err?.result || err?.response?.data?.code;
      setMessage(MESSAGES[result] || GENERIC);
      setBusy(false);
    }
  }

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
            {busy ? 'Vinculando…' : 'Confirmar vinculación'}
          </button>
        </div>
        {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
      </section>
    </div>
  );
}
