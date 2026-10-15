import React from 'react';
import { MapPin, Info, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', US: 'United States'
};

const DEFAULT_STATE_RATES = {
  FL: { dry_van: '2.87', reefer: '3.12', flatbed: '3.89', drayage: '2.76' },
  OK: { dry_van: '2.82', reefer: '2.82', flatbed: '2.82', drayage: '2.76' },
  TX: { dry_van: '2.82', reefer: '2.82', flatbed: '2.82', drayage: '2.76' },
  GA: { dry_van: '2.87', reefer: '3.20', flatbed: '3.12', drayage: '2.76' },
  NC: { dry_van: '2.75', reefer: '3.10', flatbed: '3.00', drayage: '2.76' },
  SC: { dry_van: '2.78', reefer: '3.12', flatbed: '3.02', drayage: '2.76' },
  TN: { dry_van: '2.80', reefer: '3.15', flatbed: '3.08', drayage: '2.76' },
  AL: { dry_van: '2.76', reefer: '3.10', flatbed: '3.05', drayage: '2.76' },
  US: { dry_van: '3.07', reefer: '3.66', flatbed: '3.65', drayage: '2.80' },
};

function formatMoney(val, fallback = '0') {
  if (val == null || isNaN(val)) return fallback;
  return Number(val).toLocaleString('en-US');
}

class AdvisorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error("MarketAdvisorCard error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function MarketAdvisorCardContent({ data, costConfig }) {
  const { locale } = useLanguage();
  if (!data || !data.calculo) return null;

  const { origen, destino, calculo, stateMarketData } = data;
  const { millasIda, piso, objetivo, costoPorMillaPropio, tarifaObjetivaPropia, equipmentLabel, targetSource } = calculo;
  
  const originStr = origen ? origen : 'Unknown';
  const destStr = destino ? destino : (calculo?.ciudad || 'Unknown');

  // Detectar equipo
  let equipKey = null;
  if (equipmentLabel) {
    const el = equipmentLabel.toLowerCase();
    if (el.includes('van')) equipKey = 'dry_van';
    else if (el.includes('reefer') || el.includes('refeer') || el.includes('refrig')) equipKey = 'reefer';
    else if (el.includes('flat') || el.includes('plataforma') || el.includes('fat')) equipKey = 'flatbed';
    else if (el.includes('contenedor') || el.includes('container') || el.includes('drayage')) equipKey = 'drayage';
  }

  let stateRate = null;

  // Extraer estado de origen y destino
  let originStateCode = null;
  const stateMatchOrig = originStr.match(/\b([A-Z]{2})\b/i);
  if (stateMatchOrig) {
    originStateCode = stateMatchOrig[1].toUpperCase();
  } else {
    const rawLower = originStr.toLowerCase();
    for (const [code, name] of Object.entries(STATE_NAMES)) {
      if (rawLower.includes(name.toLowerCase())) {
        originStateCode = code;
        break;
      }
    }
  }

  let destStateCode = null;
  const stateMatchDest = destStr.match(/\b([A-Z]{2})\b/i);
  if (stateMatchDest) {
    destStateCode = stateMatchDest[1].toUpperCase();
  } else {
    const rawLower = destStr.toLowerCase();
    for (const [code, name] of Object.entries(STATE_NAMES)) {
      if (rawLower.includes(name.toLowerCase())) {
        destStateCode = code;
        break;
      }
    }
  }

  // REGLA: Si la ruta es entre dos estados diferentes (interestatal), toma la tarifa nacional (US)
  const isInterstate = Boolean(originStateCode && destStateCode && originStateCode !== destStateCode);
  let lookupStateCode = isInterstate ? 'US' : (destStateCode || originStateCode || calculo?.estado || 'US');

  // 1. Priorizar stateMarketData de la base de datos (Base44) si existe
  if (lookupStateCode && equipKey && stateMarketData && Array.isArray(stateMarketData)) {
    const stateData = stateMarketData.find(s => {
      if (!s.state_code) return false;
      const dbState = s.state_code.trim().toUpperCase();
      const dbStateLower = s.state_code.trim().toLowerCase();
      return dbState === lookupStateCode || 
             (STATE_NAMES[lookupStateCode] && dbStateLower === STATE_NAMES[lookupStateCode].toLowerCase());
    });
    if (stateData && stateData[equipKey] && Number(stateData[equipKey]) > 0) {
      stateRate = Number(stateData[equipKey]).toFixed(2);
    }
  }

  // 2. Si no vino en la base de datos, usar tarifas por defecto del sistema
  if (!stateRate && lookupStateCode && equipKey && DEFAULT_STATE_RATES[lookupStateCode]?.[equipKey]) {
    stateRate = DEFAULT_STATE_RATES[lookupStateCode][equipKey];
  }

  // 3. Si no hay para el estado específico, buscar promedio nacional 'US' en stateMarketData
  if (!stateRate && equipKey && stateMarketData && Array.isArray(stateMarketData)) {
    const nationalData = stateMarketData.find(s => s.state_code && s.state_code.trim().toUpperCase() === 'US');
    if (nationalData && nationalData[equipKey]) {
      stateRate = Number(nationalData[equipKey]).toFixed(2);
    }
  }

  // 4. Fallback final nacional en DEFAULT_STATE_RATES
  if (!stateRate && equipKey && DEFAULT_STATE_RATES.US?.[equipKey]) {
    stateRate = DEFAULT_STATE_RATES.US[equipKey];
  }

  const isNeighborFL = /(?:^|[^a-z])(georgia|ga|alabama|al)(?:[^a-z]|$)/i.test(origen || '') || /(?:^|[^a-z])(georgia|ga|alabama|al)(?:[^a-z]|$)/i.test(destino || '');
  const isNeighborTX = /(?:^|[^a-z])(oklahoma|ok|new mexico|nm|louisiana|la|arkansas|ar)(?:[^a-z]|$)/i.test(origen || '') || /(?:^|[^a-z])(oklahoma|ok|new mexico|nm|louisiana|la|arkansas|ar)(?:[^a-z]|$)/i.test(destino || '');
  const isWithinNeighborLimit = (isNeighborFL || isNeighborTX) && millasIda <= 200;
  
  const isContainer = equipmentLabel && (equipmentLabel.toLowerCase().includes("contenedor") || equipmentLabel.toLowerCase().includes("container") || equipmentLabel.toLowerCase().includes("drayage"));
  const isOver200 = millasIda > 200;
  const isTableRoute = calculo.fuenteMillas === 'tabla' || calculo.targetSource === 'tabla';

  // Si el camión ya es de tipo reefer, no mostrar el recargo accesorial de contenedor refrigerado en el semáforo
  if (equipKey === 'reefer' && calculo.accesoriales && calculo.accesoriales.items) {
    calculo.accesoriales.items = calculo.accesoriales.items.filter(item => !item.concepto.toLowerCase().includes('reefer'));
  }

  let marketFloorTotal = (costoPorMillaPropio && isOver200)
    ? Math.round(costoPorMillaPropio * millasIda)
    : (piso || null);
  
  let marketTargetTotal = objetivo;

  // Sumar accesoriales si existen
  let totalAccesoriales = 0;
  if (calculo.accesoriales && calculo.accesoriales.items && calculo.accesoriales.items.length > 0) {
    for (const a of calculo.accesoriales.items) {
      const match = typeof a.monto === 'string' ? a.monto.match(/\$?\s*(\d+(\.\d+)?)/) : null;
      if (match) {
        totalAccesoriales += parseFloat(match[1]);
      } else if (typeof a.monto === 'number') {
        totalAccesoriales += a.monto;
      }
    }
  }

  // Resolver fallback de piso
  if (marketFloorTotal === null && isOver200) {
    marketFloorTotal = Math.round((costoPorMillaPropio || 1.75) * millasIda);
  }

  // Sumar accesoriales a los totales
  if (totalAccesoriales > 0) {
    if (marketFloorTotal !== null) {
      marketFloorTotal += totalAccesoriales;
    }
    marketTargetTotal += totalAccesoriales;
  }

  // Sanity check visual para evitar rangos invertidos
  if (marketFloorTotal !== null && marketTargetTotal < marketFloorTotal) {
    const temp = marketFloorTotal;
    marketFloorTotal = marketTargetTotal;
    marketTargetTotal = temp;
  }

  // RPMs calculados
  const marketFloorRpm = marketFloorTotal ? (marketFloorTotal / millasIda).toFixed(2) : null;
  const marketTargetRpm = (marketTargetTotal / millasIda).toFixed(2);

  // Valores de la calculadora del usuario
  const userCpm = (costoPorMillaPropio != null && !isNaN(costoPorMillaPropio) && costoPorMillaPropio > 0)
    ? Number(costoPorMillaPropio).toFixed(2)
    : (costConfig?.costo_por_milla != null ? Number(costConfig.costo_por_milla).toFixed(2) : '1.77');

  const rawBreakEven = calculo.tarifaBreakEvenPropia 
    ?? (costConfig?.tarifa_break_even != null ? Number(costConfig.tarifa_break_even) : null);
  const userBreakEven = (rawBreakEven != null && !isNaN(rawBreakEven) && rawBreakEven > 0)
    ? rawBreakEven.toFixed(2)
    : (costoPorMillaPropio ? (costoPorMillaPropio * 1.05).toFixed(2) : userCpm);

  const userTargetCalculator = (tarifaObjetivaPropia != null && !isNaN(tarifaObjetivaPropia) && tarifaObjetivaPropia > 0)
    ? Number(tarifaObjetivaPropia).toFixed(2)
    : (costConfig?.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo).toFixed(2) : null);

  const userCpmNum = parseFloat(userCpm);
  const userBreakEvenNum = parseFloat(userBreakEven);
  const userTargetNum = (userTargetCalculator != null && !isNaN(parseFloat(userTargetCalculator)) && parseFloat(userTargetCalculator) > 0)
    ? parseFloat(userTargetCalculator)
    : 0;

  // Tarifa por estado numérica de referencia
  const tarifaEstadoVal = stateRate != null
    ? parseFloat(stateRate)
    : (calculo.tarifaPromedioEstado != null
        ? Number(calculo.tarifaPromedioEstado)
        : (marketTargetTotal && millasIda ? Number((marketTargetTotal / millasIda).toFixed(2)) : 0));

  // Tarifa objetivo por milla para rutas > 200 millas y cálculo de Total
  let targetRpm;
  let totalTarget;

  if (isContainer && isTableRoute && isOver200) {
    // 1. Contenedor > 200 millas con tabla:
    // Al ser ida y vuelta (round trip), el RPM es: tarifa objetivo de la tabla / (2 * millas de la tabla)
    targetRpm = (objetivo / (2 * millasIda)).toFixed(2);
    totalTarget = marketTargetTotal;
  } else if (isContainer && !isTableRoute) {
    // 2. SOLO para CONTENEDORES cuyas millas NO están en la tabla:
    // Caso donde la tarifa objetivo es 0:
    // cuando el CPM es menor a la tarifa del estado, tomar la tarifa por estado
    if (userTargetNum > 0 && (!tarifaEstadoVal || userTargetNum > tarifaEstadoVal)) {
      targetRpm = userTargetNum.toFixed(2);
    } else if (tarifaEstadoVal > 0) {
      targetRpm = tarifaEstadoVal.toFixed(2);
    } else if (userTargetNum > 0) {
      targetRpm = userTargetNum.toFixed(2);
    } else {
      targetRpm = (marketTargetTotal / millasIda).toFixed(2);
    }
    totalTarget = Math.round(parseFloat(targetRpm) * millasIda) + totalAccesoriales;
  } else {
    // 3. Equipos generales (Dry Van, Reefer, Flatbed, etc.):
    // Regla: Cuando la tarifa objetivo es mayor a la tarifa por estado, tomar tarifa objetivo.
    // Caso donde la tarifa objetivo es 0 o menor:
    // cuando el CPM es menor a la tarifa del estado, tomar la tarifa por estado.
    if (userTargetNum > 0 && tarifaEstadoVal > 0 && userTargetNum > tarifaEstadoVal) {
      targetRpm = userTargetNum.toFixed(2);
    } else if (tarifaEstadoVal > 0) {
      targetRpm = tarifaEstadoVal.toFixed(2);
    } else if (userTargetNum > 0) {
      targetRpm = userTargetNum.toFixed(2);
    } else {
      targetRpm = (marketTargetTotal / millasIda).toFixed(2);
    }
    totalTarget = Math.round(parseFloat(targetRpm) * millasIda) + totalAccesoriales;
  }

  // Regla especial: Cuando el CPM es mayor a la tarifa del estado,
  // O cuando la tarifa objetivo sea 0 y el CPM sea menor/bajo al promedio de tarifas por estado
  // para contenedores donde las millas no están en la base de datos:
  // - roja queda igual (< CPM)
  // - amarilla sea del CPM al break-even
  // - verde sea mayor al break-even
  const isCpmHigherThanState = Boolean(tarifaEstadoVal > 0 && userCpmNum > tarifaEstadoVal);
  const isContainerZeroTargetCpmLow = Boolean(
    isContainer && 
    !isTableRoute && 
    userTargetNum <= 0 && 
    (tarifaEstadoVal > 0 && userCpmNum <= tarifaEstadoVal)
  );
  const applyBreakEvenAsGreen = isCpmHigherThanState || isContainerZeroTargetCpmLow || (userTargetNum <= 0 && userBreakEvenNum > 0);

  const totalCpmFloor = Math.round(userCpmNum * millasIda);
  const totalYellowFloor = Math.round(userBreakEvenNum * millasIda) + totalAccesoriales;

  // Variables dinámicas para el semáforo y recomendación
  const yellowMinRpm = applyBreakEvenAsGreen ? userCpm : userBreakEven;
  const yellowMaxRpm = applyBreakEvenAsGreen ? userBreakEven : targetRpm;
  const yellowMinTotal = applyBreakEvenAsGreen ? (totalCpmFloor + totalAccesoriales) : totalYellowFloor;
  const yellowMaxTotal = applyBreakEvenAsGreen ? totalYellowFloor : totalTarget;

  const greenRpm = applyBreakEvenAsGreen ? userBreakEven : targetRpm;
  const greenTotal = applyBreakEvenAsGreen ? totalYellowFloor : totalTarget;
  const greenSubtitle = applyBreakEvenAsGreen
    ? (locale === 'en' ? "your break-even" : "tu break-even")
    : (locale === 'en' ? "your target" : "tu objetivo");

  const isEs = locale === 'es';

  const accessorialNames = (calculo.accesoriales && calculo.accesoriales.items) 
    ? calculo.accesoriales.items.map(item => item.concepto.replace(/\s*\([A-Z]+\)/i, '')).join(", ") 
    : "";
  const hasAccessorials = accessorialNames.length > 0;
  const tOfrecida = calculo.tarifaOfrecida ? Number(calculo.tarifaOfrecida) : null;
  const ofrecidaRpm = (tOfrecida && millasIda) ? (tOfrecida / millasIda).toFixed(2) : null;

  return (
    <div className="w-full max-w-4xl mx-auto font-sans flex flex-col gap-4 mt-2">
      {/* HEADER */}
      <div className={`bg-[#2A2B3D] rounded-xl p-5 border border-border/10 ${calculo.tarifaOfrecida ? 'text-center flex flex-col items-center' : ''}`}>
        <div className={`flex items-center gap-3 mb-2 ${calculo.tarifaOfrecida ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
            <span className="text-xl">🤖</span>
          </div>
          <h2 className="text-white font-semibold text-lg">
            {isEs ? `Aquí está el análisis para ${originStr} → ${destStr}.` : `Here's the analysis for ${originStr} → ${destStr}.`}
          </h2>
        </div>

        <p className={`text-sm text-gray-300 leading-relaxed ${calculo.tarifaOfrecida ? 'text-center' : 'ml-11'}`}>
          {calculo.tarifaOfrecida ? (
            hasAccessorials ? (
              isEs
                ? `El valor del ${accessorialNames} es de $${formatMoney(totalAccesoriales)}. Sumándolo a la meta, el veredicto de tu oferta queda así:`
                : `The value for ${accessorialNames} is $${formatMoney(totalAccesoriales)}. Added to the target, the verdict for your offer looks like this:`
            ) : (
              isEs 
                ? "¡Aquí tienes el resultado de tu oferta! Mira este escenario para saber al instante si la tarifa propuesta es la ideal para tu operación."
                : "Here is the result of your offer! Check this scenario to instantly know if the proposed rate is ideal for your operation."
            )
          ) : (
            hasAccessorials ? (
              isEs
                ? `Mira el valor del ${accessorialNames} es de $${formatMoney(totalAccesoriales)} y con el semáforo quedaría así:`
                : `Look, the value for ${accessorialNames} is $${formatMoney(totalAccesoriales)} and the traffic light looks like this:`
            ) : (
              isEs 
                ? `Te muestro tres escenarios para que puedas ver rápidamente si te conviene aceptar, negociar o rechazar la carga${!isOver200 ? '.' : ' basándote en tu costo por milla (CPM).'}` 
                : `I'm showing three scenarios so you can quickly see if you should take, negotiate or decline the load${!isOver200 ? '.' : ' based on your cost per mile (CPM).'}`
            )
          )}
        </p>
      </div>

      {/* CONDITIONAL LAYOUT: SIDE-BY-SIDE IF TARIFA OFRECIDA, ELSE 3-COL SCENARIOS */}
      {calculo.tarifaOfrecida ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* CAJA 1: VEREDICTO DE LA OFERTA */}
          {(() => {
            const tTarget = applyBreakEvenAsGreen ? greenTotal : Number(marketTargetTotal);
            const effectiveFloor = applyBreakEvenAsGreen ? (totalCpmFloor + totalAccesoriales) : (marketFloorTotal ? Number(marketFloorTotal) : (tTarget * 0.90));
            
            const showRed = tOfrecida === null || tOfrecida < effectiveFloor;
            const showYellow = tOfrecida === null || (tOfrecida >= effectiveFloor && tOfrecida < tTarget);

            const targetRpmVal = applyBreakEvenAsGreen ? greenRpm : (targetRpm || (tTarget && millasIda ? (tTarget / millasIda).toFixed(2) : null));
            const floorRpmVal = applyBreakEvenAsGreen ? yellowMinRpm : (marketFloorRpm || (effectiveFloor && millasIda ? (effectiveFloor / millasIda).toFixed(2) : (targetRpmVal ? (Number(targetRpmVal) * 0.90).toFixed(2) : null)));

            if (showRed) {
              return (
                <div className="rounded-xl border border-red-900/50 bg-[#1A1115] p-5 flex flex-col justify-between items-center text-center h-full">
                  <div className="flex flex-col items-center w-full">
                    <div className="flex items-center gap-3 justify-center mb-2">
                      <div className="w-8 h-8 rounded-full bg-red-500 flex-shrink-0"></div>
                      <div className="flex flex-col items-center">
                        <span className="text-white font-bold text-lg leading-tight">{isEs ? "ROJO" : "RED"}</span>
                        <span className="text-red-400 text-sm">{isEs ? "Rechazar" : "Decline"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center mt-3">
                      <span className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">
                        {isEs ? "Tarifa de la ruta" : "Route rate"}
                      </span>
                      <span className="text-white font-semibold text-xl">
                        ${formatMoney(calculo.tarifaOfrecida)} &lt; ${formatMoney(marketFloorTotal || marketTargetTotal)} {isEs ? (marketFloorTotal ? '' : 'Mínimo') : (marketFloorTotal ? '' : 'Minimum')}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10 w-full text-center">
                    <span className="text-red-400 font-bold text-xs uppercase tracking-wider block mb-1">
                      {isEs ? "Recomendación Trucky" : "Trucky Recommendation"}
                    </span>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      {isEs 
                        ? "Ese valor está por debajo de tu valor RPM y costo, te sugiero rechazar o pedir una tarifa significativamente mayor." 
                        : "That rate is below your RPM cost, I suggest declining or asking for a significantly higher rate."}
                    </p>
                  </div>
                </div>
              );
            }

            if (showYellow) {
              return (
                <div className="rounded-xl border border-yellow-700/50 bg-[#1A1A11] p-5 flex flex-col justify-between items-center text-center h-full">
                  <div className="flex flex-col items-center w-full">
                    <div className="flex items-center gap-3 justify-center mb-2">
                      <div className="w-8 h-8 rounded-full bg-yellow-400 flex-shrink-0"></div>
                      <div className="flex flex-col items-center">
                        <span className="text-white font-bold text-lg leading-tight">{isEs ? "AMARILLO" : "YELLOW"}</span>
                        <span className="text-yellow-400 text-sm">{isEs ? "Negocia" : "Negotiate"}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center mt-3">
                      <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-1">
                        {isEs ? "Tarifa de la ruta" : "Route rate"}
                      </span>
                      <span className="text-white font-semibold text-xl">
                        ${formatMoney(calculo.tarifaOfrecida)} ~ ${formatMoney(marketTargetTotal)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10 w-full text-center">
                    <span className="text-yellow-400 font-bold text-xs uppercase tracking-wider block mb-1">
                      {isEs ? "Recomendación Trucky" : "Trucky Recommendation"}
                    </span>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      {isEs 
                        ? "Ese valor está por debajo del objetivo pero dentro del rango negociable, te sugiero negociar para alcanzar el objetivo." 
                        : "That rate is below target but within negotiable range, I suggest negotiating to reach the target."}
                    </p>
                  </div>
                </div>
              );
            }

            return (
              <div className="rounded-xl border border-green-800/50 bg-[#0F1A13] p-5 flex flex-col justify-between items-center text-center h-full">
                <div className="flex flex-col items-center w-full">
                  <div className="flex items-center gap-3 justify-center mb-2">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex-shrink-0"></div>
                    <div className="flex flex-col items-center">
                      <span className="text-white font-bold text-lg leading-tight">{isEs ? "VERDE" : "GREEN"}</span>
                      <span className="text-green-400 text-sm">{isEs ? "Buena para aceptar" : "Good to Accept"}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center mt-3">
                    <span className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-1">
                      {isEs ? "Tarifa de la ruta" : "Route rate"}
                    </span>
                    <span className="text-white font-semibold text-xl">
                      ${formatMoney(calculo.tarifaOfrecida)} &ge; ${formatMoney(marketTargetTotal)}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-white/10 w-full text-center">
                  <span className="text-green-400 font-bold text-xs uppercase tracking-wider block mb-1">
                    {isEs ? "Recomendación Trucky" : "Trucky Recommendation"}
                  </span>
                  <p className="text-gray-200 text-sm leading-relaxed">
                    {isEs 
                      ? "Ese valor está por encima del valor RPM, te sugiero aceptar." 
                      : "That rate is above the target RPM value, I suggest accepting."}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* CAJA 2: DETALLES DE LA RUTA AL LADO */}
          <div className="bg-[#1C1D2A] border border-border/20 rounded-xl p-5 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold text-base">{isEs ? "Detalles de la Ruta" : "Route Details"}</h3>
              </div>
              <div className="space-y-2.5 text-sm text-gray-300 ml-11">
                <p>{isEs ? "Desde" : "From"}: {originStr}</p>
                <p>{isEs ? "Hacia" : "To"}: {destStr}</p>
                <p>{isEs ? "Distancia (cargado)" : "Distance (loaded)"}: {millasIda} {isEs ? "millas (aprox.)" : "miles (approx.)"}</p>
                <p className="text-white font-medium">
                  {isEs ? "Tarifa propuesta" : "Offered rate"}: ${formatMoney(calculo.tarifaOfrecida)} {ofrecidaRpm ? `($${ofrecidaRpm} RPM)` : ''}
                </p>
                <p>
                  {isContainer ? (
                    isTableRoute 
                      ? (isEs ? `Tarifa objetivo (tabla): $${targetRpm}/mi ($${formatMoney(totalTarget)} total)` : `Target rate (table): $${targetRpm}/mi ($${formatMoney(totalTarget)} total)`)
                      : (isEs ? `Tarifa objetivo: $${targetRpm}/mi ($${formatMoney(totalTarget)} total)` : `Target rate: $${targetRpm}/mi ($${formatMoney(totalTarget)} total)`)
                  ) : (
                    isEs 
                      ? (isCpmHigherThanState
                          ? `Tarifa objetivo (break-even): $${userBreakEven}/mi`
                          : `${isInterstate ? "Tarifa promedio nacional (US)" : "Tarifa promedio por estado"}: $${targetRpm}/mi`)
                      : (isCpmHigherThanState
                          ? `Target rate (break-even): $${userBreakEven}/mi`
                          : `${isInterstate ? "National average rate (US)" : "State average rate"}: $${targetRpm}/mi`)
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* SCENARIOS (3 COLUMNAS NORMAL) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(() => {
              const tTarget = Number(marketTargetTotal);
              const effectiveFloor = marketFloorTotal ? Number(marketFloorTotal) : (tTarget * 0.90);
              
              const showRed = tOfrecida === null || tOfrecida < effectiveFloor;
              const showYellow = tOfrecida === null || (tOfrecida >= effectiveFloor && tOfrecida < tTarget);
              const showGreen = tOfrecida === null || tOfrecida >= tTarget;

              return (
                <>
                  {/* RED BOX */}
                  {showRed && (
                    <div className="rounded-xl border border-red-900/50 bg-[#1A1115] p-5 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-red-500 flex-shrink-0"></div>
                        <div className="flex flex-col">
                          <span className="text-white font-bold text-lg leading-tight">{isEs ? "ROJO" : "RED"}</span>
                          <span className="text-red-400 text-sm">{isEs ? "Rechazar" : "Decline"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {!isOver200 ? (
                          <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"} &lt; ${formatMoney(marketTargetTotal)}</span>
                        ) : (
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"} &lt; ${userCpm} CPM</span>
                            </div>
                            <span className="text-red-400 font-semibold mt-1">Total &lt; ${formatMoney(totalCpmFloor)}</span>
                          </div>
                        )}
                      </div>
                      <ul className="text-sm text-gray-300 space-y-3 mt-2">
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "La tarifa por milla está por debajo de tu costo." : "Rate per mile is below your cost."}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Perderías dinero con esta carga." : "You would lose money on this load."}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Considera rechazarla o pedir una tarifa significativamente mayor." : "Consider declining or asking for a significantly higher rate."}</span>
                        </li>
                      </ul>
                    </div>
                  )}

                  {/* YELLOW BOX */}
                  {showYellow && (
                    <div className="rounded-xl border border-yellow-700/50 bg-[#1A1A11] p-5 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-yellow-400 flex-shrink-0"></div>
                        <div className="flex flex-col">
                          <span className="text-white font-bold text-lg leading-tight">{isEs ? "AMARILLO" : "YELLOW"}</span>
                          <span className="text-yellow-400 text-sm">{isEs ? "Negocia" : "Negotiate"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {!isOver200 ? (
                          <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"} ~ ${formatMoney(marketTargetTotal)}</span>
                        ) : (
                          <div className="flex flex-col">
                            <span className="text-white font-semibold text-lg">${yellowMinRpm} - ${yellowMaxRpm} RPM</span>
                            <span className="text-yellow-400 font-semibold mt-1">Total: ${formatMoney(yellowMinTotal)} - ${formatMoney(yellowMaxTotal)}</span>
                          </div>
                        )}
                      </div>
                      {isOver200 && (
                        <div className="text-white text-md">
                          ≈ {isEs ? "tu break-even" : "your break-even"}
                        </div>
                      )}
                      <ul className="text-sm text-gray-300 space-y-3 mt-2">
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Esta tarifa ronda tu punto de equilibrio (break-even)." : "This rate is around your break-even point."}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Intenta negociar una tarifa mayor para llegar al objetivo." : "Try to negotiate for a higher rate to reach the target."}</span>
                        </li>
                      </ul>
                    </div>
                  )}

                  {/* GREEN BOX */}
                  {showGreen && (
                    <div className="rounded-xl border border-green-800/50 bg-[#0F1A13] p-5 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-500 flex-shrink-0"></div>
                        <div className="flex flex-col">
                          <span className="text-white font-bold text-lg leading-tight">{isEs ? "VERDE" : "GREEN"}</span>
                          <span className="text-green-400 text-sm">{isEs ? "Buena para aceptar" : "Good to Accept"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {!isOver200 ? (
                          <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"} &ge; ${formatMoney(marketTargetTotal)}</span>
                        ) : (
                          <div className="flex flex-col">
                            <span className="text-white font-semibold text-lg">${greenRpm}+ RPM</span>
                            <span className="text-green-400 font-semibold mt-1">Total: ${formatMoney(greenTotal)}+</span>
                          </div>
                        )}
                      </div>
                      {isOver200 && (
                        <div className="text-white text-md">≥ {greenSubtitle}</div>
                      )}
                      <ul className="text-sm text-gray-300 space-y-3 mt-2">
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Tarifa rentable." : "Profitable rate."}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Iguala o supera el objetivo del mercado." : "Matches or exceeds the market target."}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                          <span>{isEs ? "Buena opción para aceptar, especialmente si consigues una carga de regreso decente." : "Good option to accept, especially if you can secure a decent backhaul."}</span>
                        </li>
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* DETALLES DE LA RUTA (NORMAL) */}
          <div className="w-full">
            <div className="bg-[#1C1D2A] border border-border/20 rounded-xl p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold text-base">{isEs ? "Detalles de la Ruta" : "Route Details"}</h3>
              </div>
              <div className="space-y-2 text-sm text-gray-300 ml-11">
                <p>{isEs ? "Desde" : "From"}: {originStr}</p>
                <p>{isEs ? "Hacia" : "To"}: {destStr}</p>
                <p>{isEs ? "Distancia (cargado)" : "Distance (loaded)"}: {millasIda} {isEs ? "millas (aprox.)" : "miles (approx.)"}</p>
                
                {!isOver200 ? (
                  <p>{isEs ? "Tarifas planas" : "Flat rates"}: ${formatMoney(marketTargetTotal)} total</p>
                ) : (
                  <p>
                    {isContainer ? (
                      isTableRoute 
                        ? (isEs ? `Tarifa objetivo (tabla): $${targetRpm}/mi ($${formatMoney(totalTarget)} total)` : `Target rate (table): $${targetRpm}/mi ($${formatMoney(totalTarget)} total)`)
                        : (isEs ? `Tarifa objetivo: $${targetRpm}/mi ($${formatMoney(totalTarget)} total)` : `Target rate: $${targetRpm}/mi ($${formatMoney(totalTarget)} total)`)
                    ) : (
                      isEs 
                        ? (isCpmHigherThanState
                            ? `Tarifa objetivo (break-even): $${userBreakEven}/mi`
                            : `${isInterstate ? "Tarifa promedio nacional (US)" : "Tarifa promedio por estado"}: $${targetRpm}/mi`)
                        : (isCpmHigherThanState
                            ? `Target rate (break-even): $${userBreakEven}/mi`
                            : `${isInterstate ? "National average rate (US)" : "State average rate"}: $${targetRpm}/mi`)
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* RECOMMENDATION (TRUCKY AI NORMAL) */}
          <div className="border border-green-500/50 bg-[#0F1A13] rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-1">
                <CheckCircle2 className="w-6 h-6 text-[#0F1A13]" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-white font-semibold text-base">{isEs ? "Recomendación de TruckyAI" : "TruckyAI Recommendation"}</h3>
                <p className="text-sm text-gray-300">
                  {isEs 
                    ? (!isOver200
                        ? `Apunta por lo menos a $${formatMoney(marketTargetTotal)} o más para que esa carga valga la pena.` 
                        : (isCpmHigherThanState
                            ? `Apunta a por lo menos $${greenRpm} RPM o más para que esta carga valga la pena.`
                            : `Apunta a por lo menos $${greenRpm} RPM ($${formatMoney(greenTotal)}) o más para que esta carga valga la pena.`))
                    : (!isOver200
                        ? `Aim for at least $${formatMoney(marketTargetTotal)} or more to make this load worthwhile.`
                        : (isCpmHigherThanState
                            ? `Aim for at least $${greenRpm} RPM or higher to make this load worthwhile.`
                            : `Aim for at least $${greenRpm} RPM ($${formatMoney(greenTotal)}) or higher to make this load worthwhile.`))}
                </p>
                <p className="text-sm text-gray-300">
                  {isEs 
                    ? (!isOver200
                        ? `Si la oferta está cercana a $${formatMoney(marketTargetTotal)}, negocia.` 
                        : `Si la oferta está entre $${yellowMinRpm} - $${yellowMaxRpm} RPM, negocia y confirma si incluye el regreso.`)
                    : (!isOver200
                        ? `If the offer is close to $${formatMoney(marketTargetTotal)}, negotiate.`
                        : `If the offer is between $${yellowMinRpm} - $${yellowMaxRpm} RPM, negotiate and confirm if it includes the return.`)}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function MarketAdvisorCard(props) {
  return (
    <AdvisorErrorBoundary>
      <MarketAdvisorCardContent {...props} />
    </AdvisorErrorBoundary>
  );
}
