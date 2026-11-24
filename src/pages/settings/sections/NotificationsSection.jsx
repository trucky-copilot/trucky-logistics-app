// F3-15 · Fase 7 — Notificaciones: qué avisos ver y con cuánta anticipación.
import React from 'react';
import { Truck, Users, Building2, Package, Bell, CalendarClock } from 'lucide-react';
import { Card, SwitchRow, OptionGroup, usePrefs } from './PreferenceControls';
import { EXPIRY_DAYS } from '@/lib/userPreferences';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

export default function NotificationsSection({ locale }) {
  const [prefs, update] = usePrefs();
  const n = prefs.notificaciones;
  const set = (cambios) => update('notificaciones', cambios);

  const tipos = [
    { id: 'conductores', icon: Users, title: tx(locale, 'Conductores', 'Drivers'), desc: tx(locale, 'Documentos vencidos o por vencer, suspensiones y vacaciones.', 'Expired or expiring documents, suspensions and vacations.') },
    { id: 'cargas', icon: Package, title: tx(locale, 'Cargas', 'Loads'), desc: tx(locale, 'Entregas retrasadas, cargas sin asignar, canceladas o con pérdida.', 'Late deliveries, unassigned, cancelled or losing loads.') },
    { id: 'flota', icon: Truck, title: tx(locale, 'Flota', 'Fleet'), desc: tx(locale, 'Camiones en mantenimiento, en yarda o sin chasis.', 'Trucks in maintenance, in the yard or without chassis.') },
    { id: 'brokers', icon: Building2, title: 'Brokers', desc: tx(locale, 'Brokers bloqueados, en observación, con baja calificación o plazos de pago largos.', 'Blocked brokers, under caution, low rating or long payment terms.') },
    { id: 'sistema', icon: Bell, title: tx(locale, 'Avisos del sistema', 'System alerts'), desc: tx(locale, 'Automatizaciones terminadas, correos de carga y otros avisos de Trucky.', 'Finished automations, load emails and other Trucky notices.') },
  ];

  return (
    <div className="space-y-5">
      <Card
        title={tx(locale, 'Qué avisos quieres ver', 'Which alerts you want to see')}
        desc={tx(locale, 'Aplica a la campana, el Dashboard y la página de Notificaciones. Apagar un tipo solo lo oculta; no borra nada.', 'Applies to the bell, the Dashboard and the Notifications page. Turning a type off only hides it; nothing is deleted.')}
      >
        {tipos.map((t, i) => (
          <React.Fragment key={t.id}>
            {i > 0 && <div className="border-t border-border" />}
            <SwitchRow id={`pref-notif-${t.id}`} icon={t.icon} title={t.title} desc={t.desc} checked={n[t.id] !== false} onChange={(v) => set({ [t.id]: v })} />
          </React.Fragment>
        ))}
      </Card>

      <Card
        title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-t-text-accent" />{tx(locale, 'Aviso de documentos por vencer', 'Expiring document notice')}</span>}
        desc={tx(locale, 'Con cuántos días de anticipación avisar que vence la licencia, el médico, TWIC o HazMat de un conductor. Los vencidos se avisan siempre.', 'How many days in advance to warn that a driver\'s license, medical, TWIC or HazMat expires. Expired ones are always shown.')}
      >
        <OptionGroup
          label={tx(locale, 'Días de anticipación', 'Days in advance')}
          value={Number(n.dias_vencimiento)}
          onChange={(v) => set({ dias_vencimiento: v })}
          options={EXPIRY_DAYS.map((d) => ({ id: d, label: tx(locale, `${d} días`, `${d} days`) }))}
        />
      </Card>

      <p className="text-xs text-muted-foreground">{tx(locale, 'Se guarda en este navegador.', 'Saved in this browser.')}</p>
    </div>
  );
}
