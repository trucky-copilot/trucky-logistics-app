const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../base44/functions/analyzeDocument/entry.ts');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
  // validarRate
  { 
    find: /hallazgos\.push\(`⚠ Descuentos\/deducciones detectados: \$\{datos\.deducciones \|\| datos\.descuentos\} — revisar impacto`\);/g, 
    replace: "hallazgos.push(locale === 'en' ? `⚠ Discounts/deductions detected: ${datos.deducciones || datos.descuentos} — review impact` : `⚠ Descuentos/deducciones detectados: ${datos.deducciones || datos.descuentos} — revisar impacto`);" 
  },
  { find: /'No encontrada'/g, replace: "locale === 'en' ? 'Not found' : 'No encontrada'" },
  { find: /'No calculada'/g, replace: "locale === 'en' ? 'Not calculated' : 'No calculada'" },
  { find: /'No especificado'/g, replace: "locale === 'en' ? 'Not specified' : 'No especificado'" },
  { find: /'No especificada'/g, replace: "locale === 'en' ? 'Not specified' : 'No especificada'" },
  { find: /'No aceptar hasta corregir — tarifa o condiciones inaceptables'/g, replace: "locale === 'en' ? 'Do not accept until corrected — unacceptable rate or conditions' : 'No aceptar hasta corregir — tarifa o condiciones inaceptables'" },
  { find: /'Negociar términos antes de aceptar'/g, replace: "locale === 'en' ? 'Negotiate terms before accepting' : 'Negociar términos antes de aceptar'" },
  { find: /'Aceptar — tarifa y condiciones de pago correctas'/g, replace: "locale === 'en' ? 'Accept — correct rate and payment conditions' : 'Aceptar — tarifa y condiciones de pago correctas'" },

  // validarCommodity
  { find: /'⚠ Commodity no especificada en el documento'/g, replace: "locale === 'en' ? '⚠ Commodity not specified in document' : '⚠ Commodity no especificada en el documento'" },
  { find: /`✓ Commodity: \$\{datos\.commodity\}`/g, replace: "locale === 'en' ? `✓ Commodity: ${datos.commodity}` : `✓ Commodity: ${datos.commodity}`" },
  { find: /`✓ Peso: \$\{datos\.peso\}`/g, replace: "locale === 'en' ? `✓ Weight: ${datos.peso}` : `✓ Peso: ${datos.peso}`" },
  { find: /'⚠ Commodity muy genérica — solicitar descripción específica'/g, replace: "locale === 'en' ? '⚠ Very generic commodity — request specific description' : '⚠ Commodity muy genérica — solicitar descripción específica'" },
  { find: /'No aceptar — restricciones de commodity o capacidad'/g, replace: "locale === 'en' ? 'Do not accept — commodity or capacity restrictions' : 'No aceptar — restricciones de commodity o capacidad'" },
  { find: /'Revisar — validar detalles de carga antes de aceptar'/g, replace: "locale === 'en' ? 'Review — validate load details before accepting' : 'Revisar — validar detalles de carga antes de aceptar'" },
  { find: /'Aceptar — commodity aprobada y capacidad confirmada'/g, replace: "locale === 'en' ? 'Accept — approved commodity and confirmed capacity' : 'Aceptar — commodity aprobada y capacidad confirmada'" },

  // validarCarrier
  { find: /'No mencionado'/g, replace: "locale === 'en' ? 'Not mentioned' : 'No mencionado'" },
  { find: /'No aceptar — disparidad grave en carrier asignado'/g, replace: "locale === 'en' ? 'Do not accept — severe disparity in assigned carrier' : 'No aceptar — disparidad grave en carrier asignado'" },
  { find: /'Revisar — confirmar identidad del carrier y MC'/g, replace: "locale === 'en' ? 'Review — confirm carrier identity and MC' : 'Revisar — confirmar identidad del carrier y MC'" },
  { find: /'Aceptar — carrier validado'/g, replace: "locale === 'en' ? 'Accept — validated carrier' : 'Aceptar — carrier validado'" },

  // validarEquipo
  { find: /'No aceptar — requerimientos de equipo incumplidos'/g, replace: "locale === 'en' ? 'Do not accept — equipment requirements not met' : 'No aceptar — requerimientos de equipo incumplidos'" },
  { find: /'Negociar — aclarar detalles de equipo'/g, replace: "locale === 'en' ? 'Negotiate — clarify equipment details' : 'Negociar — aclarar detalles de equipo'" },
  { find: /'Aceptar — equipo validado'/g, replace: "locale === 'en' ? 'Accept — validated equipment' : 'Aceptar — equipo validado'" },

  // validarFechasOperacion
  { find: /`⚠ Pickup en el pasado \(\$\{datos\.pickup_fecha\}\)`/g, replace: "locale === 'en' ? `⚠ Pickup in the past (${datos.pickup_fecha})` : `⚠ Pickup en el pasado (${datos.pickup_fecha})`" },
  { find: /`⚠ Pickup programado para hoy \(\$\{datos\.pickup_fecha\}\)`/g, replace: "locale === 'en' ? `⚠ Pickup scheduled for today (${datos.pickup_fecha})` : `⚠ Pickup programado para hoy (${datos.pickup_fecha})`" },
  { find: /'⚠ Faltan fechas de Pickup o Delivery'/g, replace: "locale === 'en' ? '⚠ Missing Pickup or Delivery dates' : '⚠ Faltan fechas de Pickup o Delivery'" },
  { find: /`⚠ Tiempo de tránsito sospechoso \(\$\{dias\} días para \$\{millas\} millas\)`/g, replace: "locale === 'en' ? `⚠ Suspicious transit time (${dias} days for ${millas} miles)` : `⚠ Tiempo de tránsito sospechoso (${dias} días para ${millas} millas)`" },
  { find: /'No aceptar — inconsistencias operativas graves'/g, replace: "locale === 'en' ? 'Do not accept — severe operational inconsistencies' : 'No aceptar — inconsistencias operativas graves'" },
  { find: /'Negociar — revisar tiempos de tránsito'/g, replace: "locale === 'en' ? 'Negotiate — review transit times' : 'Negociar — revisar tiempos de tránsito'" },
  { find: /'Aceptar — viabilidad operativa confirmada'/g, replace: "locale === 'en' ? 'Accept — confirmed operational viability' : 'Aceptar — viabilidad operativa confirmada'" },

  // validarClausulasYCondiciones
  { find: /'Ninguna'/g, replace: "locale === 'en' ? 'None' : 'Ninguna'" },
  { find: /'No aceptar — cláusulas abusivas o responsabilidad excesiva'/g, replace: "locale === 'en' ? 'Do not accept — abusive clauses or excessive liability' : 'No aceptar — cláusulas abusivas o responsabilidad excesiva'" },
  { find: /'Negociar — revisar cláusulas antes de firmar'/g, replace: "locale === 'en' ? 'Negotiate — review clauses before signing' : 'Negociar — revisar cláusulas antes de firmar'" },
  { find: /'Aceptar — cláusulas dentro de parámetros normales'/g, replace: "locale === 'en' ? 'Accept — clauses within normal parameters' : 'Aceptar — cláusulas dentro de parámetros normales'" },

  // Prompt adjustments
  { 
    find: /Genera el resumen_ejecutivo y las respuestas cortas en el idioma del documento \(generalmente español o inglés\)\./g, 
    replace: "Genera TODOS los textos de respuesta (resumen_ejecutivo, hallazgos_clave, etc.) ESTRICTAMENTE en este idioma: ${locale === 'en' ? 'INGLÉS' : 'ESPAÑOL'}." 
  }
];

let modifiedContent = content;
replacements.forEach(({ find, replace }) => {
  modifiedContent = modifiedContent.replace(find, replace);
});

fs.writeFileSync(filePath, modifiedContent, 'utf8');
console.log('Translations applied successfully!');
