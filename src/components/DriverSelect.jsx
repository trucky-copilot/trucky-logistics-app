import { AlertTriangle } from 'lucide-react';

/**
 * Lista de conductores del carrier activo (por ID) + advertencia de documentos.
 * Si el conductor tiene un documento VENCIDO, se exige confirmar antes de asignar.
 */
export default function DriverSelect({ options, value, legacyName, onChange, acknowledged, onAcknowledge, isEs = true }) {
  const selected = options.find(o => String(o.id) === String(value)) || null;
  const expired = selected ? selected.issues.filter(i => i.level === 'expired') : [];
  const soon = selected ? selected.issues.filter(i => i.level === 'soon') : [];

  return (
    <div className="space-y-2">
      <select
        value={value || ''}
        onChange={e => onChange(options.find(o => String(o.id) === e.target.value) || null)}
        className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        <option value="">{isEs ? '— Sin conductor —' : '— No driver —'}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}{o.placa ? ` · ${o.placa}` : ''}{o.issues.some(i => i.level === 'expired') ? (isEs ? ' ⚠ documento vencido' : ' ⚠ expired document') : ''}
          </option>
        ))}
      </select>

      {!value && legacyName && (
        <p className="text-[11px] text-muted-foreground">
          {isEs ? `Texto anterior: "${legacyName}". Elige el conductor de la lista para vincularlo.`
                : `Previous text: "${legacyName}". Pick the driver from the list to link it.`}
        </p>
      )}

      {options.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {isEs ? 'No hay conductores disponibles en este perfil.' : 'No available drivers in this profile.'}
        </p>
      )}

      {expired.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {expired.map(i => i.text).join(' · ')}
          </p>
          <label className="flex items-center gap-2 text-[11px] text-red-200 cursor-pointer">
            <input type="checkbox" checked={Boolean(acknowledged)} onChange={e => onAcknowledge(e.target.checked)} />
            {isEs ? 'Entiendo el riesgo y quiero asignarlo de todos modos' : 'I understand the risk and want to assign anyway'}
          </label>
        </div>
      )}

      {soon.length > 0 && (
        <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> {soon.map(i => i.text).join(' · ')}
        </p>
      )}
    </div>
  );
}

/** ¿Se puede asignar? Bloquea si hay documento vencido sin confirmar. */
export function canAssign(option, acknowledged) {
  if (!option) return true;
  return !option.issues.some(i => i.level === 'expired') || Boolean(acknowledged);
}
