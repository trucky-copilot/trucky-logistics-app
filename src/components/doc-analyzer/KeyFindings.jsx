import { AlertTriangle, XCircle, CheckCircle2, Info } from 'lucide-react';

function getIcon(h) {
  if (h.startsWith('❌')) return { Icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10' };
  if (h.startsWith('⚠')) return { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' };
  if (h.startsWith('✓')) return { Icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10' };
  return { Icon: Info, color: 'text-muted-foreground', bg: 'bg-muted/30' };
}

function limpiar(h) {
  return h.replace(/^[❌⚠✓ℹ!]\s*/, '').trim();
}

// Extrae el hallazgo más relevante de cada categoría (el peor)
function getTopHallazgo(cat) {
  const h = cat.hallazgos || [];
  return h.find(x => x.startsWith('❌')) || h.find(x => x.startsWith('⚠')) || h[0] || null;
}

export default function KeyFindings({ categorias }) {
  if (!categorias?.length) return null;

  // Un hallazgo por categoría, priorizando rojos > amarillos > verdes
  const rojas = categorias.filter(c => c.semaforo === 'rojo');
  const amarillas = categorias.filter(c => c.semaforo === 'amarillo');
  const verdes = categorias.filter(c => c.semaforo === 'verde');

  const seleccionados = [
    ...rojas.map(c => ({ h: getTopHallazgo(c), cat: c.categoria })),
    ...amarillas.map(c => ({ h: getTopHallazgo(c), cat: c.categoria })),
    ...verdes.map(c => ({ h: getTopHallazgo(c), cat: c.categoria })),
  ].filter(x => x.h).slice(0, 6);

  if (!seleccionados.length) return null;

  const hayProblemas = rojas.length > 0 || amarillas.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
        {hayProblemas ? 'Alertas principales' : 'Resumen de validación'}
      </p>
      <div className="space-y-2">
        {seleccionados.map(({ h, cat }, i) => {
          const { Icon, color, bg } = getIcon(h);
          return (
            <div key={i} className="flex items-start gap-2.5">
              <div className={`w-5 h-5 rounded-md ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <Icon className={`w-3 h-3 ${color}`} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-1.5">{cat}</span>
                <span className="text-xs text-foreground leading-snug">{limpiar(h)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}