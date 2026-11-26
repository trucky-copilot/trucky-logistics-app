// F3-15 · Fase 6 — Ayuda y soporte: canal de contacto y preguntas frecuentes.
import React, { useState } from 'react';
import { Mail, Copy, Check, ChevronDown, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TOUR_START_KEY } from '@/components/DemoTour';
import { useAuth } from '@/lib/AuthContext';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

const FAQ = [
  { es: ['¿Cómo conecto mi Gmail?', 'Ve a Emails y pulsa Sincronizar. Elige tu cuenta de Google y acepta los permisos de leer y enviar correos. Si Google muestra "app no verificada", pulsa Configuración avanzada → Ir a Trucky.'],
    en: ['How do I connect my Gmail?', 'Go to Emails and click Sync. Choose your Google account and accept the permissions to read and send emails. If Google shows "unverified app", click Advanced → Go to Trucky.'] },
  { es: ['¿Cómo verifico una rate confirmation?', 'En Verificador sube el PDF o pega el texto y pulsa Verificar documento. También puedes abrir un correo con el PDF adjunto y pulsar Automatización.'],
    en: ['How do I check a rate confirmation?', 'In Document Checker upload the PDF or paste the text and click Verify Document. You can also open an email with the PDF attached and click Automation.'] },
  { es: ['¿Cómo creo una carga desde un correo?', 'Abre el correo del broker → Automatización → revisa el resultado del verificador → Crear carga con estos datos. Revisa los datos y pulsa Guardar.'],
    en: ['How do I create a load from an email?', 'Open the broker email → Automation → review the checker result → Create load from this data. Review the fields and click Save.'] },
  { es: ['¿Dónde configuro mis costos?', 'En Configuración → Mis costos y cargos, o en la Calculadora: diésel, MPG, pago al conductor y tu tarifa objetivo. El chat y el verificador usan esos valores.'],
    en: ['Where do I set my costs?', 'In Settings → My costs & charges, or in the Calculator: diesel, MPG, driver pay and your target rate. The chat and the checker use those values.'] },
  { es: ['¿Cómo cambio o cancelo mi plan?', 'En Configuración → Mi plan ves tu suscripción, tus cobros y la opción de cancelar al final del período.'],
    en: ['How do I change or cancel my plan?', 'In Settings → My plan you can see your subscription, your charges and the option to cancel at the end of the period.'] },
];

export default function HelpSection({ locale }) {
  const { user } = useAuth();
  const [copiado, setCopiado] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const navigate = useNavigate();
  // Sale de Configuración y arranca el recorrido en la app.
  const verRecorrido = () => {
    try { sessionStorage.setItem(TOUR_START_KEY, '1'); } catch { /* sin almacenamiento */ }
    navigate('/');
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Contactar a soporte', 'Contact support')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{tx(locale, 'Escríbenos con tu consulta o problema; te respondemos por correo.', 'Write to us with your question or problem; we reply by email.')}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 flex items-center gap-2 text-sm text-foreground"><Mail className="w-4 h-4 text-primary" /> {SUPPORT_EMAIL}</div>
          <button type="button" onClick={copiar} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-foreground hover:bg-muted">
            {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? tx(locale, 'Copiado', 'Copied') : tx(locale, 'Copiar', 'Copy')}
          </button>
          <a href={supportMailto({ locale, email: user?.email || '' })}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Mail className="w-4 h-4" /> {tx(locale, 'Escribir a soporte', 'Email support')}
          </a>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card/60 p-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Recorrido por Trucky', 'Trucky tour')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{tx(locale, 'Te mostramos paso a paso cada módulo, desde la calculadora hasta el dashboard.', 'We show you each module step by step, from the calculator to the dashboard.')}</p>
        </div>
        <button type="button" onClick={verRecorrido}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
          <PlayCircle className="w-4 h-4" /> {tx(locale, 'Ver recorrido de nuevo', 'Replay the tour')}
        </button>
      </section>

      <section className="rounded-xl border border-border bg-card/60 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Preguntas frecuentes', 'Frequently asked questions')}</h3>
        <ul className="divide-y divide-border">
          {FAQ.map((f, i) => {
            const [q, a] = locale === 'en' ? f.en : f.es;
            const open = abierta === i;
            return (
              <li key={i}>
                <button type="button" onClick={() => setAbierta(open ? null : i)} aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 py-3 text-left text-sm text-foreground hover:text-primary">
                  {q} <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && <p className="pb-3 text-sm text-muted-foreground">{a}</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
