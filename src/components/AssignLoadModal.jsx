import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import DriverSelect, { canAssign } from '@/components/DriverSelect';
import { buildDriverOptions } from '@/lib/driverAssignment';

/**
 * Asignar conductor desde Flota: el dispatcher elige PRIMERO la carga y luego
 * el conductor (antes se tomaba sola la primera carga pendiente).
 */
export default function AssignLoadModal({ loads, drivers, trucks, isEs, busy, onAssign, onClose }) {
  const assignable = (loads || []).filter(l => l.estado === 'pendiente' || !l.conductor_id);
  const [loadId, setLoadId] = useState(assignable[0]?.id || '');
  const [driverId, setDriverId] = useState('');
  const [ack, setAck] = useState(false);

  const load = assignable.find(l => String(l.id) === String(loadId)) || null;
  const options = buildDriverOptions({ drivers, trucks, loads, currentLoadId: load?.id, isEs });
  const option = options.find(o => String(o.id) === String(driverId)) || null;
  const ready = Boolean(load && option && canAssign(option, ack));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{isEs ? 'Asignar conductor a una carga' : 'Assign a driver to a load'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">1. {isEs ? 'Carga' : 'Load'}</label>
            {assignable.length === 0 ? (
              <p className="text-xs text-muted-foreground">{isEs ? 'No hay cargas pendientes en este perfil.' : 'No pending loads in this profile.'}</p>
            ) : (
              <select value={loadId} onChange={e => { setLoadId(e.target.value); setDriverId(''); setAck(false); }}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                {assignable.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.origen} → {l.destino}{l.numero_referencia ? ` · ${l.numero_referencia}` : ''}{l.fecha_carga ? ` · ${String(l.fecha_carga).slice(0, 10)}` : ''}{l.conductor_nombre ? ` (${l.conductor_nombre})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">2. {isEs ? 'Conductor disponible' : 'Available driver'}</label>
            <DriverSelect options={options} value={driverId}
              onChange={opt => { setDriverId(opt?.id || ''); setAck(false); }}
              acknowledged={ack} onAcknowledge={setAck} isEs={isEs} />
          </div>

          <p className="text-[11px] text-muted-foreground">
            {isEs ? 'Se guardará en la carga y se preparará un borrador de correo. El correo no se envía solo.'
                  : 'It will be saved on the load and an email draft will be prepared. The email is not sent automatically.'}
          </p>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">{isEs ? 'Cancelar' : 'Cancel'}</button>
          <button disabled={!ready || busy} onClick={() => onAssign(load, option)}
            className="flex-1 py-2.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}{isEs ? 'Asignar' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
