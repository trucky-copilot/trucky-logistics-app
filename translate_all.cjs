const fs = require('fs');
let content = fs.readFileSync('base44/functions/analyzeDocument/entry.ts', 'utf8');

const translations = [
  // validarCommodity
  [
    "hallazgos.push(`❌ Commodity requiere ${label} — carrier NO tiene esta capacidad habilitada`);",
    "hallazgos.push(locale === 'en' ? `❌ Commodity requires ${label} — carrier does NOT have this capability enabled` : `❌ Commodity requiere ${label} — carrier NO tiene esta capacidad habilitada`);"
  ],
  [
    "hallazgos.push(`⚠ Commodity requiere ${label} — verificar capacidad del carrier`);",
    "hallazgos.push(locale === 'en' ? `⚠ Commodity requires ${label} — verify carrier capacity` : `⚠ Commodity requiere ${label} — verificar capacidad del carrier`);"
  ],
  [
    "hallazgos.push(`✓ Carrier habilitado para ${label}`);",
    "hallazgos.push(locale === 'en' ? `✓ Carrier enabled for ${label}` : `✓ Carrier habilitado para ${label}`);"
  ],
  [
    "hallazgos.push(`❌ Commodity \"${datos.commodity}\" está RESTRINGIDA en el perfil del carrier`);",
    "hallazgos.push(locale === 'en' ? `❌ Commodity \"${datos.commodity}\" is RESTRICTED in carrier profile` : `❌ Commodity \"${datos.commodity}\" está RESTRINGIDA en el perfil del carrier`);"
  ],
  [
    "hallazgos.push('⚠ Commodity refrigerada pero equipo no parece reefer — verificar');",
    "hallazgos.push(locale === 'en' ? '⚠ Refrigerated commodity but equipment does not look like a reefer — verify' : '⚠ Commodity refrigerada pero equipo no parece reefer — verificar');"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — commodity incompatible con la operación'\n      : semaforo === 'amarillo' ? 'Revisar antes de aceptar — commodity requiere confirmación'\n      : 'Aceptar — commodity estándar y compatible',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — commodity incompatible with operation' : 'No aceptar — commodity incompatible con la operación')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Review before accepting — commodity requires confirmation' : 'Revisar antes de aceptar — commodity requiere confirmación')\n      : (locale === 'en' ? 'Accept — standard and compatible commodity' : 'Aceptar — commodity estándar y compatible'),"
  ],
  [
    "categoria: 'Commodity',",
    "categoria: locale === 'en' ? 'Commodity' : 'Commodity',"
  ],

  // validarEquipo
  [
    "hallazgos.push('⚠ Tipo de equipo/contenedor no especificado en el documento');",
    "hallazgos.push(locale === 'en' ? '⚠ Equipment/container type not specified in document' : '⚠ Tipo de equipo/contenedor no especificado en el documento');"
  ],
  [
    "hallazgos.push(`✓ Equipo requerido: ${equipo}`);",
    "hallazgos.push(locale === 'en' ? `✓ Required equipment: ${equipo}` : `✓ Equipo requerido: ${equipo}`);"
  ],
  [
    "hallazgos.push(`❌ Equipo requerido es ${equipo} pero carrier solo tiene: ${carrierProfile.equipment_types.join(', ')}`);",
    "hallazgos.push(locale === 'en' ? `❌ Required equipment is ${equipo} but carrier only has: ${carrierProfile.equipment_types.join(', ')}` : `❌ Equipo requerido es ${equipo} pero carrier solo tiene: ${carrierProfile.equipment_types.join(', ')}`);"
  ],
  [
    "hallazgos.push(`⚠ Equipo requerido es ${equipo} — verificar compatibilidad con carrier`);",
    "hallazgos.push(locale === 'en' ? `⚠ Required equipment is ${equipo} — verify compatibility with carrier` : `⚠ Equipo requerido es ${equipo} — verificar compatibilidad con carrier`);"
  ],
  [
    "hallazgos.push(`✓ Equipo del carrier coincide con requerimiento (${carrierProfile.equipment_types.find(e => equipoLower.includes(e.toLowerCase()))})`);",
    "hallazgos.push(locale === 'en' ? `✓ Carrier equipment matches requirement (${carrierProfile.equipment_types.find(e => equipoLower.includes(e.toLowerCase()))})` : `✓ Equipo del carrier coincide con requerimiento (${carrierProfile.equipment_types.find(e => equipoLower.includes(e.toLowerCase()))})`);"
  ],
  [
    "hallazgos.push(`⚠ Equipo requerido menciona \"Air Ride\" — verificar que carrier lo ofrezca`);",
    "hallazgos.push(locale === 'en' ? `⚠ Required equipment mentions \"Air Ride\" — verify carrier offers it` : `⚠ Equipo requerido menciona \"Air Ride\" — verificar que carrier lo ofrezca`);"
  ],
  [
    "hallazgos.push(`⚠ Documento pide \"Vented\" — verificar con carrier antes de asignar`);",
    "hallazgos.push(locale === 'en' ? `⚠ Document requests \"Vented\" — verify with carrier before assigning` : `⚠ Documento pide \"Vented\" — verificar con carrier antes de asignar`);"
  ],
  [
    "hallazgos.push(`⚠ Equipo requerido menciona \"E-Track\" o sujeciones especiales`);",
    "hallazgos.push(locale === 'en' ? `⚠ Required equipment mentions \"E-Track\" or special securement` : `⚠ Equipo requerido menciona \"E-Track\" o sujeciones especiales`);"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — equipo del carrier incompatible con la carga'\n      : semaforo === 'amarillo' ? 'Verificar compatibilidad de equipo antes de aceptar'\n      : 'Aceptar — equipo es compatible',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — carrier equipment incompatible with load' : 'No aceptar — equipo del carrier incompatible con la carga')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Verify equipment compatibility before accepting' : 'Verificar compatibilidad de equipo antes de aceptar')\n      : (locale === 'en' ? 'Accept — equipment is compatible' : 'Aceptar — equipo es compatible'),"
  ],
  [
    "categoria: 'Equipo y Chasis',",
    "categoria: locale === 'en' ? 'Equipment and Chassis' : 'Equipo y Chasis',"
  ],

  // validarBroker
  [
    "hallazgos.push(`⚠ Broker no encontrado en historial — primer contacto, verificar credenciales`);",
    "hallazgos.push(locale === 'en' ? `⚠ Broker not found in history — first contact, verify credentials` : `⚠ Broker no encontrado en historial — primer contacto, verificar credenciales`);"
  ],
  [
    "hallazgos.push(`✓ Broker verificado: ${brokerProfile.company_name}`);",
    "hallazgos.push(locale === 'en' ? `✓ Verified broker: ${brokerProfile.company_name}` : `✓ Broker verificado: ${brokerProfile.company_name}`);"
  ],
  [
    "hallazgos.push(`✓ Broker: ${datos.broker_nombre}`);",
    "hallazgos.push(locale === 'en' ? `✓ Broker: ${datos.broker_nombre}` : `✓ Broker: ${datos.broker_nombre}`);"
  ],
  [
    "hallazgos.push(`⚠ Calificación de broker baja: ${brokerProfile.rating}/10`);",
    "hallazgos.push(locale === 'en' ? `⚠ Low broker rating: ${brokerProfile.rating}/10` : `⚠ Calificación de broker baja: ${brokerProfile.rating}/10`);"
  ],
  [
    "hallazgos.push(`⚠ Broker suele pagar tarde (${brokerProfile.days_to_pay} días promedio)`);",
    "hallazgos.push(locale === 'en' ? `⚠ Broker usually pays late (${brokerProfile.days_to_pay} days average)` : `⚠ Broker suele pagar tarde (${brokerProfile.days_to_pay} días promedio)`);"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — broker con muy mal historial'\n      : semaforo === 'amarillo' ? 'Tomar precauciones — revisar reputación o términos de pago del broker'\n      : 'Aceptar — broker confiable y verificado',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — broker with very bad history' : 'No aceptar — broker con muy mal historial')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Take precautions — review broker reputation or payment terms' : 'Tomar precauciones — revisar reputación o términos de pago del broker')\n      : (locale === 'en' ? 'Accept — reliable and verified broker' : 'Aceptar — broker confiable y verificado'),"
  ],
  [
    "categoria: 'Broker',",
    "categoria: locale === 'en' ? 'Broker' : 'Broker',"
  ],

  // validarCarrier
  [
    "hallazgos.push('⚠ Nombre del carrier no encontrado en el documento');",
    "hallazgos.push(locale === 'en' ? '⚠ Carrier name not found in document' : '⚠ Nombre del carrier no encontrado en el documento');"
  ],
  [
    "hallazgos.push(`✓ Carrier verificado: ${carrierProfile.legal_name}`);",
    "hallazgos.push(locale === 'en' ? `✓ Verified carrier: ${carrierProfile.legal_name}` : `✓ Carrier verificado: ${carrierProfile.legal_name}`);"
  ],
  [
    "hallazgos.push(`❌ Documento asignado a otro carrier: ${datos.carrier_nombre}`);",
    "hallazgos.push(locale === 'en' ? `❌ Document assigned to another carrier: ${datos.carrier_nombre}` : `❌ Documento asignado a otro carrier: ${datos.carrier_nombre}`);"
  ],
  [
    "hallazgos.push(`⚠ El nombre en el documento (${datos.carrier_nombre}) no coincide exactamente con tu perfil`);",
    "hallazgos.push(locale === 'en' ? `⚠ The name in the document (${datos.carrier_nombre}) does not exactly match your profile` : `⚠ El nombre en el documento (${datos.carrier_nombre}) no coincide exactamente con tu perfil`);"
  ],
  [
    "hallazgos.push(`❌ MC incorrecto en documento: ${datos.carrier_mc} (Debe ser ${carrierProfile.mc_number})`);",
    "hallazgos.push(locale === 'en' ? `❌ Incorrect MC in document: ${datos.carrier_mc} (Should be ${carrierProfile.mc_number})` : `❌ MC incorrecto en documento: ${datos.carrier_mc} (Debe ser ${carrierProfile.mc_number})`);"
  ],
  [
    "hallazgos.push('✓ MC coincide');",
    "hallazgos.push(locale === 'en' ? '✓ MC matches' : '✓ MC coincide');"
  ],
  [
    "hallazgos.push(`❌ DOT incorrecto en documento: ${datos.carrier_dot} (Debe ser ${carrierProfile.dot_number})`);",
    "hallazgos.push(locale === 'en' ? `❌ Incorrect DOT in document: ${datos.carrier_dot} (Should be ${carrierProfile.dot_number})` : `❌ DOT incorrecto en documento: ${datos.carrier_dot} (Debe ser ${carrierProfile.dot_number})`);"
  ],
  [
    "hallazgos.push('✓ DOT coincide');",
    "hallazgos.push(locale === 'en' ? '✓ DOT matches' : '✓ DOT coincide');"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — identidad comprometida o asignado a otro carrier'\n      : semaforo === 'amarillo' ? 'Aclarar identidad con el broker antes de firmar'\n      : 'Aceptar — identidad verificada',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — compromised identity or assigned to another carrier' : 'No aceptar — identidad comprometida o asignado a otro carrier')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Clarify identity with broker before signing' : 'Aclarar identidad con el broker antes de firmar')\n      : (locale === 'en' ? 'Accept — identity verified' : 'Aceptar — identidad verificada'),"
  ],
  [
    "categoria: 'Carrier / Identidad',",
    "categoria: locale === 'en' ? 'Carrier / Identity' : 'Carrier / Identidad',"
  ],

  // validarFechasOperacion
  [
    "hallazgos.push('⚠ Fechas de operación (pickup/delivery) incompletas en el documento');",
    "hallazgos.push(locale === 'en' ? '⚠ Incomplete operation dates (pickup/delivery) in document' : '⚠ Fechas de operación (pickup/delivery) incompletas en el documento');"
  ],
  [
    "hallazgos.push(`❌ Pickup programado en el pasado: ${datos.pickup_fecha}`);",
    "hallazgos.push(locale === 'en' ? `❌ Pickup scheduled in the past: ${datos.pickup_fecha}` : `❌ Pickup programado en el pasado: ${datos.pickup_fecha}`);"
  ],
  [
    "hallazgos.push(`⚠ Tiempo de tránsito muy corto: solo ${horas.toFixed(1)} horas para ${datos.millas} millas`);",
    "hallazgos.push(locale === 'en' ? `⚠ Transit time very short: only ${horas.toFixed(1)} hours for ${datos.millas} miles` : `⚠ Tiempo de tránsito muy corto: solo ${horas.toFixed(1)} horas para ${datos.millas} millas`);"
  ],
  [
    "hallazgos.push(`❌ Imposible cumplir: requiere promedio de ${(datos.millas / horas).toFixed(1)} mph`);",
    "hallazgos.push(locale === 'en' ? `❌ Impossible to meet: requires average of ${(datos.millas / horas).toFixed(1)} mph` : `❌ Imposible cumplir: requiere promedio de ${(datos.millas / horas).toFixed(1)} mph`);"
  ],
  [
    "hallazgos.push(`✓ Tiempos de tránsito viables: promedio de ${(datos.millas / horas).toFixed(1)} mph`);",
    "hallazgos.push(locale === 'en' ? `✓ Viable transit times: average of ${(datos.millas / horas).toFixed(1)} mph` : `✓ Tiempos de tránsito viables: promedio de ${(datos.millas / horas).toFixed(1)} mph`);"
  ],
  [
    "hallazgos.push('✓ Fechas de operación parecen razonables');",
    "hallazgos.push(locale === 'en' ? '✓ Operation dates seem reasonable' : '✓ Fechas de operación parecen razonables');"
  ],
  [
    "hallazgos.push('⚠ Falta número de referencia (Load # / DO #) en el documento');",
    "hallazgos.push(locale === 'en' ? '⚠ Missing reference number (Load # / DO #) in document' : '⚠ Falta número de referencia (Load # / DO #) en el documento');"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — fechas imposibles o referencias ausentes'\n      : semaforo === 'amarillo' ? 'Confirmar tiempos y referencias con el broker'\n      : 'Aceptar — plan de viaje viable',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — impossible dates or missing references' : 'No aceptar — fechas imposibles o referencias ausentes')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Confirm times and references with broker' : 'Confirmar tiempos y referencias con el broker')\n      : (locale === 'en' ? 'Accept — viable trip plan' : 'Aceptar — plan de viaje viable'),"
  ],
  [
    "categoria: 'Fechas y Operación',",
    "categoria: locale === 'en' ? 'Dates and Operation' : 'Fechas y Operación',"
  ],

  // validarClausulas
  [
    "hallazgos.push(`❌ Múltiples cláusulas de riesgo: ${encontradas.join(', ')}`);",
    "hallazgos.push(locale === 'en' ? `❌ Multiple risk clauses: ${encontradas.join(', ')}` : `❌ Múltiples cláusulas de riesgo: ${encontradas.join(', ')}`);"
  ],
  [
    "hallazgos.push(`⚠ Cláusula de riesgo detectada: ${encontradas[0]}`);",
    "hallazgos.push(locale === 'en' ? `⚠ Risk clause detected: ${encontradas[0]}` : `⚠ Cláusula de riesgo detectada: ${encontradas[0]}`);"
  ],
  [
    "hallazgos.push('⚠ Detention no especificada');",
    "hallazgos.push(locale === 'en' ? '⚠ Detention not specified' : '⚠ Detention no especificada');"
  ],
  [
    "hallazgos.push(`⚠ Detention baja: ${datos.detention_rate} (estándar: $50-75/hr)`);",
    "hallazgos.push(locale === 'en' ? `⚠ Low detention: ${datos.detention_rate} (standard: $50-75/hr)` : `⚠ Detention baja: ${datos.detention_rate} (estándar: $50-75/hr)`);"
  ],
  [
    "hallazgos.push(`✓ Detention: ${datos.detention_rate}${datos.detention_free_time ? ' | Free: ' + datos.detention_free_time : ''}`);",
    "hallazgos.push(locale === 'en' ? `✓ Detention: ${datos.detention_rate}${datos.detention_free_time ? ' | Free: ' + datos.detention_free_time : ''}` : `✓ Detention: ${datos.detention_rate}${datos.detention_free_time ? ' | Free: ' + datos.detention_free_time : ''}`);"
  ],
  [
    "hallazgos.push(`⚠ Demurrage: ${datos.demurrage} — verificar quién asume el costo`);",
    "hallazgos.push(locale === 'en' ? `⚠ Demurrage: ${datos.demurrage} — verify who assumes the cost` : `⚠ Demurrage: ${datos.demurrage} — verificar quién asume el costo`);"
  ],
  [
    "hallazgos.push(`❌ Cláusula de responsabilidad excesiva del carrier detectada`);",
    "hallazgos.push(locale === 'en' ? `❌ Excessive carrier liability clause detected` : `❌ Cláusula de responsabilidad excesiva del carrier detectada`);"
  ],
  [
    "hallazgos.push(`⚠ Responsabilidad del carrier: ${datos.responsabilidad_carrier} — revisar alcance`);",
    "hallazgos.push(locale === 'en' ? `⚠ Carrier liability: ${datos.responsabilidad_carrier} — review scope` : `⚠ Responsabilidad del carrier: ${datos.responsabilidad_carrier} — revisar alcance`);"
  ],
  [
    "hallazgos.push('✓ Sin cláusulas de riesgo detectadas');",
    "hallazgos.push(locale === 'en' ? '✓ No risk clauses detected' : '✓ Sin cláusulas de riesgo detectadas');"
  ],
  [
    "recomendacion: semaforo === 'rojo' ? 'No aceptar — cláusulas abusivas o responsabilidad excesiva'\n      : semaforo === 'amarillo' ? 'Negociar — revisar cláusulas antes de firmar'\n      : 'Aceptar — términos limpios',",
    "recomendacion: semaforo === 'rojo' ? (locale === 'en' ? 'Do not accept — abusive clauses or excessive liability' : 'No aceptar — cláusulas abusivas o responsabilidad excesiva')\n      : semaforo === 'amarillo' ? (locale === 'en' ? 'Negotiate — review clauses before signing' : 'Negociar — revisar cláusulas antes de firmar')\n      : (locale === 'en' ? 'Accept — clean terms' : 'Aceptar — términos limpios'),"
  ],
  [
    "categoria: 'Cláusulas y Penalidades',",
    "categoria: locale === 'en' ? 'Clauses and Penalties' : 'Cláusulas y Penalidades',"
  ],

  // calcularVeredicto
  [
    "veredicto = 'No aceptar hasta corregir';",
    "veredicto = locale === 'en' ? 'Do not accept until corrected' : 'No aceptar hasta corregir';"
  ],
  [
    "veredicto = 'Negociar';",
    "veredicto = locale === 'en' ? 'Negotiate' : 'Negociar';"
  ],
  [
    "veredicto = 'Revisar antes de aceptar';",
    "veredicto = locale === 'en' ? 'Review before accepting' : 'Revisar antes de aceptar';"
  ],
  [
    "veredicto = 'Aceptar';",
    "veredicto = locale === 'en' ? 'Accept' : 'Aceptar';"
  ],
  [
    "resumen = userRole === 'carrier'\n      ? 'El carrier cumple los requisitos y la carga es rentable.'\n      : 'Listo para despachar. Todo en orden.';",
    "resumen = userRole === 'carrier'\n      ? (locale === 'en' ? 'Carrier meets requirements and load is profitable.' : 'El carrier cumple los requisitos y la carga es rentable.')\n      : (locale === 'en' ? 'Ready to dispatch. Everything in order.' : 'Listo para despachar. Todo en orden.');"
  ],
  [
    "resumen = userRole === 'carrier'\n      ? `${amarillos} condiciones a negociar antes de aceptar la carga.`\n      : `Revisión requerida: ${amarillos} puntos de atención para el dispatcher.`;",
    "resumen = userRole === 'carrier'\n      ? (locale === 'en' ? `${amarillos} conditions to negotiate before accepting the load.` : `${amarillos} condiciones a negociar antes de aceptar la carga.`)\n      : (locale === 'en' ? `Review required: ${amarillos} attention points for the dispatcher.` : `Revisión requerida: ${amarillos} puntos de atención para el dispatcher.`);"
  ],
  [
    "resumen = `Alerta crítica en \"${categorias.find(c => c.semaforo === 'rojo')?.categoria}\". Debe corregirse antes de proceder.`;",
    "resumen = locale === 'en' ? `Critical alert in \"${categorias.find(c => c.semaforo === 'rojo')?.categoria}\". Must be corrected before proceeding.` : `Alerta crítica en \"${categorias.find(c => c.semaforo === 'rojo')?.categoria}\". Debe corregirse antes de proceder.`;"
  ],
  [
    "resumen = userRole === 'carrier'\n      ? 'Alerta crítica en rentabilidad o riesgo contractual.'\n      : 'Alerta crítica en validación de partes o tiempos de tránsito.';",
    "resumen = userRole === 'carrier'\n      ? (locale === 'en' ? 'Critical alert in profitability or contractual risk.' : 'Alerta crítica en rentabilidad o riesgo contractual.')\n      : (locale === 'en' ? 'Critical alert in validation of parties or transit times.' : 'Alerta crítica en validación de partes o tiempos de tránsito.');"
  ]
];

for (let [search, replacement] of translations) {
  content = content.replace(search, replacement);
}

// BUMP RULES_VERSION AGAIN
content = content.replace(/const RULES_VERSION = '2\.0\.2';/g, "const RULES_VERSION = '2.0.3';");

fs.writeFileSync('base44/functions/analyzeDocument/entry.ts', content, 'utf8');
console.log('Done replacing translations');
