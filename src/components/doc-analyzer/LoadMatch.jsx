import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Link2, Package } from 'lucide-react';

const CONFIDENCE_CONFIG = {
  high:   { label: 'Alta coincidencia',  color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/20' },
  medium: { label: 'Coincidencia media', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' },
  low:    { label: 'Baja coincidencia',  color: 'text-muted-foreground', bg: 'bg-muted/50', border: 'border-border' },
};

export default function LoadMatch({ datos_extraidos }) {
  const [match, setMatch] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!datos_extraidos) { setChecked(true); return; }

    const buscar = async () => {
      const refs = [
        datos_extraidos.load_number,
        datos_extraidos.reference_number,
        datos_extraidos.delivery_order_number,
      ].filter(Boolean);

      if (refs.length === 0) { setChecked(true); return; }

      const loads = await base44.entities.Load.list('-created_date', 100);

      for (const ref of refs) {
        const found = loads.find(l =>
          (l.numero_referencia && l.numero_referencia.includes(ref)) ||
          (l.broker_nombre && datos_extraidos.broker_nombre && l.broker_nombre.toLowerCase().includes(datos_extraidos.broker_nombre.toLowerCase()))
        );
        if (found) {
          const confidence = found.numero_referencia?.includes(ref) ? 'high' : 'medium';
          setMatch({ load: found, ref, confidence });
          setChecked(true);
          return;
        }
      }
      setChecked(true);
    };
    buscar();
  }, [datos_extraidos]);

  if (!checked || !match) return null;

  const c = CONFIDENCE_CONFIG[match.confidence];

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <p className="text-xs font-bold text-foreground uppercase tracking-wide">Carga relacionada encontrada</p>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${c.border} ${c.color}`}>{c.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Ruta</p>
          <p className="font-medium text-foreground">{match.load.origen} → {match.load.destino}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Broker</p>
          <p className="font-medium text-foreground">{match.load.broker_nombre || '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Referencia encontrada</p>
          <p className="font-medium text-foreground font-mono">{match.ref}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Estado de carga</p>
          <p className="font-medium text-foreground capitalize">{match.load.estado}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <Package className="w-3 h-3 text-primary" />
        <span className="text-xs text-primary font-medium">Esta carga ya está registrada en el sistema</span>
      </div>
    </div>
  );
}