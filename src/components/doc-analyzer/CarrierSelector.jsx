import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ChevronDown, Truck } from 'lucide-react';
import { useOrganizationId } from '@/lib/AppStateContext';
import { filterByOrg } from '@/lib/orgScope';

export default function CarrierSelector({ selectedCarrierId, onChange }) {
  const orgId = useOrganizationId();
  const [carriers, setCarriers] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    filterByOrg(base44.entities.CarrierProfile, orgId, { active: true }).then(setCarriers);
  }, [orgId]);

  if (carriers.length <= 1) return null;

  const selected = carriers.find(c => c.id === selectedCarrierId) || carriers[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-border bg-muted hover:border-primary/40 transition-all text-left"
      >
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Truck className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">Verificando para</div>
          <div className="text-sm font-semibold text-foreground truncate">{selected?.company_name || 'Seleccionar carrier'}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          {carriers.map(c => (
            <button
              key={c.id}
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted transition-colors ${selectedCarrierId === c.id ? 'bg-primary/10' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{c.company_name}</div>
                <div className="text-xs text-muted-foreground">{c.mc_number || 'Sin MC'}</div>
              </div>
              {selectedCarrierId === c.id && <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}