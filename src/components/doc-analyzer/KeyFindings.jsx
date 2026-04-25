import { AlertTriangle, XCircle, CheckCircle2, Info } from 'lucide-react';

function getIcon(h) {
  if (h.startsWith('❌')) return { Icon: XCircle, color: 'text-red-400' };
  if (h.startsWith('⚠')) return { Icon: AlertTriangle, color: 'text-yellow-400' };
  if (h.startsWith('✓')) return { Icon: CheckCircle2, color: 'text-green-400' };
  return { Icon: Info, color: 'text-muted-foreground' };
}

function limpiar(h) {
  return h.replace(/^[❌⚠✓ℹ!]\s*/, '').trim();
}

export default function KeyFindings({ categorias }) {
  if (!categorias?.length) return null;

  // Recopilar hallazgos importantes: primero rojos, luego amarillos, máx 6
  const rojos = categorias
    .filter(c => c.semaforo === 'rojo')
    .flatMap(c => (c.hallazgos || []).filter(h => h.startsWith('❌')));

  const amarillos = categorias
    .filter(c => c.semaforo === 'amarillo')
    .flatMap(c => (c.hallazgos || []).filter(h => h.startsWith('⚠')));

  const todos = [...rojos, ...amarillos].slice(0, 6);

  if (todos.length === 0) {
    // Si todo está bien, mostrar los primeros verdes
    const verdes = categorias
      .flatMap(c => (c.hallazgos || []).filter(h => h.startsWith('✓')))
      .slice(0, 3);
    if (verdes.length === 0) return null;
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Hallazgos clave</p>
        <div className="space-y-2">
          {verdes.map((h, i) => {
            const { Icon, color } = getIcon(h);
            return (
              <div key={i} className="flex items-start gap-2.5">
                <Icon className={`w-3.5 h-3.5 ${color} mt-0.5 flex-shrink-0`} />
                <span className="text-sm text-foreground">{limpiar(h)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Hallazgos clave</p>
      <div className="space-y-2">
        {todos.map((h, i) => {
          const { Icon, color } = getIcon(h);
          return (
            <div key={i} className="flex items-start gap-2.5">
              <Icon className={`w-3.5 h-3.5 ${color} mt-0.5 flex-shrink-0`} />
              <span className="text-sm text-foreground">{limpiar(h)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}