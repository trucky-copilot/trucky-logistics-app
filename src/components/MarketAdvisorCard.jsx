import React from 'react';
import { MapPin, Info, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

export default function MarketAdvisorCard({ data }) {
  const { locale } = useLanguage();
  if (!data || !data.calculo) return null;

  const { origen, destino, calculo } = data;
  const { millasIda, piso, objetivo, costoPorMillaPropio, tarifaObjetivaPropia, equipmentLabel, targetSource } = calculo;

  const isDrayage = equipmentLabel && equipmentLabel.toLowerCase().includes("drayage");
  const isContainer = equipmentLabel && (equipmentLabel.toLowerCase().includes("contenedor") || equipmentLabel.toLowerCase().includes("container") || equipmentLabel.toLowerCase().includes("drayage")) && targetSource !== 'calculo';
  const isFromTable = targetSource === 'tabla';

  let marketFloorTotal = piso || null;
  let marketTargetTotal = (tarifaObjetivaPropia && targetSource === 'calculo') 
    ? Math.round(tarifaObjetivaPropia * millasIda) 
    : objetivo;

  // Sanity check visual: evitar rangos invertidos si la meta del usuario es
  // menor que el piso duro de mercado (ej. tramos muy cortos)
  if (marketFloorTotal !== null && marketTargetTotal < marketFloorTotal) {
    const temp = marketFloorTotal;
    marketFloorTotal = marketTargetTotal;
    marketTargetTotal = temp;
  }

  const marketFloorRpm = marketFloorTotal ? (marketFloorTotal / millasIda).toFixed(2) : null;
  const marketTargetRpm = (marketTargetTotal / millasIda).toFixed(2);

  const userCpm = costoPorMillaPropio ? costoPorMillaPropio.toFixed(2) : (marketFloorRpm || '1.75');
  const userTarget = tarifaObjetivaPropia ? tarifaObjetivaPropia.toFixed(2) : (marketTargetRpm || '2.20');

  const originStr = origen ? origen : 'Unknown';
  const destStr = destino ? destino : (calculo.ciudad || 'Unknown');

  const isEs = locale === 'es';

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
            isEs 
              ? "¡Aquí tienes el resultado de tu oferta! Mira este escenario para saber al instante si la tarifa propuesta es la ideal para tu operación."
              : "Here is the result of your offer! Check this scenario to instantly know if the proposed rate is ideal for your operation."
          ) : (
            isEs 
              ? `Te muestro tres escenarios para que puedas ver rápidamente si te conviene aceptar, negociar o rechazar la carga${isContainer ? '.' : ' basándote en tu costo por milla (CPM).'}` 
              : `I'm showing three scenarios so you can quickly see if you should take, negotiate or decline the load${isContainer ? '.' : ' based on your cost per mile (CPM).'}`
          )}
        </p>
      </div>

      {/* SCENARIOS */}
      <div className={`grid grid-cols-1 ${calculo.tarifaOfrecida ? 'md:grid-cols-1 max-w-lg mx-auto' : 'md:grid-cols-3'} gap-4`}>
        
        {(() => {
          // Lógica unificada para el semáforo (todas las rutas, incluyendo Florida)
          // Si no hay un piso definido en la base de datos (ej. Florida), usamos un 10% por debajo del objetivo
          // como margen de negociación ("un poquito por debajo").
          const tOfrecida = calculo.tarifaOfrecida ? Number(calculo.tarifaOfrecida) : null;
          const tTarget = Number(marketTargetTotal);
          const effectiveFloor = marketFloorTotal ? Number(marketFloorTotal) : (tTarget * 0.90);
          
          const showRed = tOfrecida === null || tOfrecida < effectiveFloor;
          const showYellow = tOfrecida === null || (tOfrecida >= effectiveFloor && tOfrecida < tTarget);
          const showGreen = tOfrecida === null || tOfrecida >= tTarget;

          return (
            <>
              {/* RED BOX */}
              {showRed && (
                <div className={`rounded-xl border border-red-900/50 bg-[#1A1115] p-5 flex flex-col gap-4 ${calculo.tarifaOfrecida ? 'items-center text-center' : ''}`}>
                  <div className={`flex items-center gap-3 ${calculo.tarifaOfrecida ? 'justify-center' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-red-500 flex-shrink-0"></div>
                    <div className={`flex flex-col ${calculo.tarifaOfrecida ? 'items-center' : ''}`}>
                      <span className="text-white font-bold text-lg leading-tight">{isEs ? "ROJO" : "RED"}</span>
                      <span className="text-red-400 text-sm">{isEs ? (calculo.tarifaOfrecida ? "Rechaza" : "Rechaza o Negocia") : (calculo.tarifaOfrecida ? "Decline" : "Decline or Negotiate")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {calculo.tarifaOfrecida ? (
                      <>
                        <span className="text-white font-semibold text-lg">${calculo.tarifaOfrecida.toLocaleString('en-US')} &lt; ${(marketFloorTotal || marketTargetTotal).toLocaleString('en-US', {maximumFractionDigits: 0})} {isEs ? (marketFloorTotal ? '' : 'Mínimo') : (marketFloorTotal ? '' : 'Minimum')}</span>
                      </>
                    ) : isContainer ? (
                      <>
                        <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"}</span>
                        <span className="text-muted-foreground">&lt;</span>
                        <span className="text-white font-semibold text-lg">${marketTargetTotal.toLocaleString('en-US')}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-white font-semibold text-lg">${(parseFloat(marketTargetRpm) * 0.9).toFixed(2)} RPM</span>
                        <span className="text-muted-foreground">&lt;</span>
                        <span className="text-white font-semibold text-lg">${userCpm} CPM</span>
                      </>
                    )}
                  </div>
                  <ul className="text-sm text-gray-300 space-y-3 mt-2">
                    <li className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                      <span>{isEs ? (calculo.tarifaOfrecida ? "La tarifa ofrecida está muy por debajo del mercado." : "La tarifa por milla está por debajo de tu costo.") : (calculo.tarifaOfrecida ? "The offered rate is way below market." : "Rate per mile is below your cost.")}</span>
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
                <div className={`rounded-xl border border-yellow-700/50 bg-[#1A1A11] p-5 flex flex-col gap-4 ${calculo.tarifaOfrecida ? 'items-center text-center' : ''}`}>
                  <div className={`flex items-center gap-3 ${calculo.tarifaOfrecida ? 'justify-center' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-yellow-400 flex-shrink-0"></div>
                    <div className={`flex flex-col ${calculo.tarifaOfrecida ? 'items-center' : ''}`}>
                      <span className="text-white font-bold text-lg leading-tight">{isEs ? "AMARILLO" : "YELLOW"}</span>
                      <span className="text-yellow-400 text-sm">{isEs ? "Negocia" : "Negotiate"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {calculo.tarifaOfrecida ? (
                      <>
                        <span className="text-white font-semibold text-lg">${calculo.tarifaOfrecida.toLocaleString('en-US')} ~ ${marketTargetTotal.toLocaleString('en-US')}</span>
                      </>
                    ) : isContainer ? (
                      <>
                        <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"}</span>
                        <span className="text-yellow-400 font-bold mx-2">~</span>
                        <span className="text-white font-semibold text-lg">${marketTargetTotal.toLocaleString('en-US')}</span>
                      </>
                    ) : (
                      <span className="text-white font-semibold text-lg">${userCpm} - ${userTarget} RPM</span>
                    )}
                  </div>
                  {!calculo.tarifaOfrecida && !isContainer && (
                    <div className="text-white text-md">≈ {isEs ? "tu CPM" : "your CPM"}</div>
                  )}
                  <ul className={`text-sm text-gray-300 space-y-3 mt-2 ${calculo.tarifaOfrecida ? 'text-left inline-block' : ''}`}>
                    <li className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                      <span>{isEs ? (calculo.tarifaOfrecida ? "La tarifa ofrecida está un poco por debajo, pero dentro del rango negociable." : "Esta tarifa ronda tu punto de equilibrio (break-even).") : (calculo.tarifaOfrecida ? "The offered rate is slightly below target but within negotiable range." : "This rate is around your break-even point.")}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                      <span>{isEs ? "Considera si solo incluye las millas cargadas o ida y vuelta." : "Consider if it includes only the loaded miles or round trip."}</span>
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
                <div className={`rounded-xl border border-green-800/50 bg-[#0F1A13] p-5 flex flex-col gap-4 ${calculo.tarifaOfrecida ? 'items-center text-center' : ''}`}>
                  <div className={`flex items-center gap-3 ${calculo.tarifaOfrecida ? 'justify-center' : ''}`}>
                    <div className="w-8 h-8 rounded-full bg-green-500 flex-shrink-0"></div>
                    <div className={`flex flex-col ${calculo.tarifaOfrecida ? 'items-center' : ''}`}>
                      <span className="text-white font-bold text-lg leading-tight">{isEs ? "VERDE" : "GREEN"}</span>
                      <span className="text-green-400 text-sm">{isEs ? "Buena para aceptar" : "Good to Accept"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {calculo.tarifaOfrecida ? (
                      <>
                        <span className="text-white font-semibold text-lg">${calculo.tarifaOfrecida.toLocaleString('en-US')} &ge; ${marketTargetTotal.toLocaleString('en-US')}</span>
                      </>
                    ) : isContainer ? (
                      <>
                        <span className="text-white font-semibold text-lg">{isEs ? "Tarifa" : "Rate"}</span>
                        <span className="text-muted-foreground mx-2">&ge;</span>
                        <span className="text-white font-semibold text-lg">${marketTargetTotal.toLocaleString('en-US')}</span>
                      </>
                    ) : (
                      <span className="text-white font-semibold text-lg">${userTarget}+ RPM</span>
                    )}
                  </div>
                  {!calculo.tarifaOfrecida && !isContainer && (
                    <div className="text-white text-md">≥ {isEs ? "tu objetivo" : "your target"}</div>
                  )}
                  <ul className={`text-sm text-gray-300 space-y-3 mt-2 ${calculo.tarifaOfrecida ? 'text-left inline-block' : ''}`}>
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

      {/* ROUTE DETAILS & KEEP IN MIND */}
      {!calculo.tarifaOfrecida && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Route Details */}
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
            {marketFloorTotal ? (
              <p>{isEs ? "Tarifa típica de mercado" : "Typical market rate"}: ${marketFloorTotal.toLocaleString('en-US')} - ${marketTargetTotal.toLocaleString('en-US')} total</p>
            ) : (
              <p>{isEs ? "Tarifa típica de mercado" : "Typical market rate"}: ${marketTargetTotal.toLocaleString('en-US')} total</p>
            )}
            {!isFromTable && millasIda >= 200 && (
              <p>
                {costoPorMillaPropio 
                  ? (isEs ? "Tu rango RPM (Costo - Objetivo)" : "Your RPM range (Cost - Target)") 
                  : (isEs ? "Rango estimado RPM" : "Estimated RPM range")}
                : ${userCpm} - ${userTarget}
              </p>
            )}
          </div>
        </div>

        {/* Keep in mind */}
        <div className="bg-[#1C1D2A] border border-border/20 rounded-xl p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Info className="w-4 h-4 text-blue-400" />
            </div>
            <h3 className="text-white font-semibold text-base">{isEs ? "Ten en cuenta:" : "Keep in mind:"}</h3>
          </div>
          <ul className="text-sm text-gray-300 space-y-3 ml-11 list-disc pl-2">
            {!isDrayage && (
              <li>{isEs ? "Verifica si la tarifa es solo por millas cargadas o ida y vuelta (incluyendo vacías)." : "Verify if the rate is for loaded miles only or round trip (including deadhead)."}</li>
            )}
            <li>{isEs ? "Considera peajes, combustible y cualquier costo adicional." : "Consider tolls, fuel, and any additional costs."}</li>
            <li>{isEs ? `Verifica si puedes conseguir una buena carga de regreso desde ${destStr}.` : `Check if you can get a good return load from ${destStr}.`}</li>
            <li>{isEs ? "Las tarifas de mercado pueden variar según el tipo de equipo, temporada y broker." : "Market rates may vary based on equipment type, season and broker."}</li>
          </ul>
        </div>
      </div>

      {/* RECOMMENDATION */}
      <div className="border border-green-500/50 bg-[#0F1A13] rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-1">
            <CheckCircle2 className="w-6 h-6 text-[#0F1A13]" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-white font-semibold text-base">{isEs ? "Recomendación de TruckyAI" : "TruckyAI Recommendation"}</h3>
            <p className="text-sm text-gray-300">
              {isEs 
                ? (isContainer ? `Apunta por lo menos a $${marketTargetTotal.toLocaleString('en-US')} o más para que esa carga valga la pena.` : `Apunta a por lo menos $${userTarget} RPM ($${Math.round(userTarget * millasIda).toLocaleString('en-US')}) o más para que esta carga valga la pena.`)
                : (isContainer ? `Aim for at least $${marketTargetTotal.toLocaleString('en-US')} or more to make this load worthwhile.` : `Aim for at least $${userTarget} RPM ($${Math.round(userTarget * millasIda).toLocaleString('en-US')}) or higher to make this load worthwhile.`)}
            </p>
            <p className="text-sm text-gray-300">
              {isEs 
                ? (isContainer ? `Si la oferta está cercana a $${marketTargetTotal.toLocaleString('en-US')}, negocia.` : `Si la oferta está entre $${userCpm} - $${userTarget} RPM, negocia y confirma si incluye el regreso.`)
                : (isContainer ? `If the offer is close to $${marketTargetTotal.toLocaleString('en-US')}, negotiate.` : `If the offer is between $${userCpm} - $${userTarget} RPM, negotiate and confirm if it includes the return.`)}
            </p>
          </div>
        </div>

      </div>
        </>
      )}
    </div>
  );
}
