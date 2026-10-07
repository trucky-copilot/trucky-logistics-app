import { AlertTriangle, XCircle, CheckCircle2, Info } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

function getIcon(h) {
  if (h.startsWith('❌')) return { Icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10' };
  if (h.startsWith('⚠')) return { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' };
  if (h.startsWith('✓')) return { Icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10' };
  return { Icon: Info, color: 'text-muted-foreground', bg: 'bg-muted/30' };
}

function limpiar(h) {
  return h.replace(/^[❌⚠✓ℹ!]\s*/, '').trim();
}

// Extrae todos los hallazgos relevantes de cada categoría
function getTopHallazgos(cat) {
  const h = cat.hallazgos || [];
  const rojos = h.filter(x => x.startsWith('❌'));
  if (rojos.length > 0) return rojos;
  const amarillos = h.filter(x => x.startsWith('⚠'));
  if (amarillos.length > 0) return amarillos;
  return h[0] ? [h[0]] : [];
}

export default function KeyFindings({ categorias }) {
  const { t, locale } = useLanguage();
  if (!categorias?.length) return null;

  // Un hallazgo por categoría, priorizando rojos > amarillos > verdes
  const rojas = categorias.filter(c => c.semaforo === 'rojo');
  const amarillas = categorias.filter(c => c.semaforo === 'amarillo');
  const verdes = categorias.filter(c => c.semaforo === 'verde');

  const seleccionados = [
    ...rojas.flatMap(c => getTopHallazgos(c).map(h => ({ h, cat: c.categoria }))),
    ...amarillas.flatMap(c => getTopHallazgos(c).map(h => ({ h, cat: c.categoria }))),
    ...verdes.flatMap(c => getTopHallazgos(c).map(h => ({ h, cat: c.categoria }))),
  ].slice(0, 10); // Aumentado a 10 para asegurar que el Rate verde se muestre

  if (!seleccionados.length) return null;

  const hayProblemas = rojas.length > 0 || amarillas.length > 0;
  
  let lastCat = null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
        {hayProblemas ? t.documents.mainAlerts : (locale === 'en' ? 'Validation summary' : 'Resumen de validación')}
      </p>
      <div className="space-y-3">
        {seleccionados.map(({ h, cat }, i) => {
          const { Icon, color, bg } = getIcon(h);
          const showCat = cat !== lastCat;
          lastCat = cat;
          return (
            <div key={i} className={`flex items-start gap-2.5 ${!showCat ? '-mt-1' : ''}`}>
              <div className={`w-5 h-5 rounded-md ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <Icon className={`w-3 h-3 ${color}`} />
              </div>
              <div className="min-w-0 flex-1">
                {showCat && <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{cat}</div>}
                <div className="text-xs text-foreground leading-snug">{limpiar(h)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}