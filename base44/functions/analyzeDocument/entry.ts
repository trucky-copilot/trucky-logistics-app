import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Reglas de negocio ────────────────────────────────────────────────────────

const CARRIER_NOMBRE = 'larcofer';
const CARRIER_MC = '1';                          // actualizar con MC real
const COMMODITIES_INCOMPATIBLES = ['hazmat', 'explosives', 'ammunition', 'radioactive'];
const EQUIPOS_SOPORTADOS = ['20', '40', '45', 'chassis', '20ft', '40ft', '45ft', 'dry', 'reefer'];
const CLAUSULAS_RIESGO = [
  'double broker', 'double-broker', 're-broker',
  'back charge', 'chargeback', 'charge-back',
  'late penalty', 'liquidated damages',
  'all risk', 'full liability',
  'no tonu', 'tonu not applicable',
  'carrier responsible for lumper',
];

// Extrae datos estructurados del documento usando LLM
async function extractDocumentData(base44, documentText) {
  return await base44.integrations.Core.InvokeLLM({
    prompt: `Eres un extractor de datos de documentos de transporte intermodal en USA. 
Extrae TODOS los datos disponibles de este Rate Confirmation o Delivery Order.
Si un campo no aparece en el documento, devuelve null para ese campo.
Responde SOLO JSON válido.

Documento:
---
${documentText.slice(0, 4000)}
---`,
    response_json_schema: {
      type: "object",
      properties: {
        tipo_documento: { type: "string" },       // "rate_confirmation" | "delivery_order" | "otro"
        // Rate y pago
        tarifa_total: { type: "number" },
        tarifa_por_milla: { type: "number" },
        terminos_pago: { type: "string" },        // "Net 30", "Quick Pay", etc.
        dias_pago: { type: "number" },
        factoring_mencionado: { type: "boolean" },
        deducciones: { type: "string" },
        // Commodity
        commodity: { type: "string" },
        peso: { type: "string" },
        // Equipo
        tipo_equipo: { type: "string" },          // "20ft", "40ft", "45ft", "chassis", etc.
        chasis_requerido: { type: "boolean" },
        chasis_provisto_por: { type: "string" },  // "carrier" | "broker" | "port"
        // Broker
        broker_nombre: { type: "string" },
        broker_mc: { type: "string" },
        broker_dot: { type: "string" },
        broker_telefono: { type: "string" },
        // Carrier
        carrier_nombre: { type: "string" },
        carrier_mc: { type: "string" },
        carrier_dot: { type: "string" },
        // Fechas y operación
        pickup_fecha: { type: "string" },
        pickup_hora: { type: "string" },
        delivery_fecha: { type: "string" },
        delivery_hora: { type: "string" },
        origen: { type: "string" },
        destino: { type: "string" },
        millas: { type: "number" },
        // Referencias
        load_number: { type: "string" },
        reference_number: { type: "string" },
        delivery_order_number: { type: "string" },
        // Cláusulas (texto raw)
        clausulas_detectadas: { type: "array", items: { type: "string" } },
        detention_rate: { type: "string" },
        tonu_rate: { type: "string" },
        penalidades: { type: "string" },
      }
    }
  });
}

// ── Validaciones por categoría ───────────────────────────────────────────────

function validarRate(datos, costConfig, userRole) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.tarifa_total) {
    hallazgos.push('No se encontró tarifa total en el documento');
    semaforo = 'rojo';
  } else if (costConfig) {
    const tarifaMinima = costConfig.tarifa_break_even || (costConfig.costo_por_milla * 1.1);
    if (datos.tarifa_por_milla && datos.tarifa_por_milla < tarifaMinima) {
      hallazgos.push(`Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi está por debajo del mínimo configurado $${tarifaMinima.toFixed(2)}/mi`);
      semaforo = 'rojo';
    } else if (datos.tarifa_por_milla && datos.tarifa_por_milla < (costConfig.tarifa_objetivo || 3.0)) {
      hallazgos.push(`Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi está por debajo del objetivo $${costConfig.tarifa_objetivo || 3.0}/mi`);
      semaforo = 'amarillo';
    }
  }

  if (!datos.terminos_pago) {
    hallazgos.push('No se especifican términos de pago');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  } else {
    if (datos.dias_pago && datos.dias_pago > 45) {
      hallazgos.push(`Plazo de pago muy largo: ${datos.dias_pago} días`);
      semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
    }
    if (datos.terminos_pago.toLowerCase().includes('quick pay') || datos.dias_pago <= 7) {
      hallazgos.push('Quick Pay disponible — verificar descuento aplicado');
    }
  }

  if (datos.deducciones) {
    hallazgos.push(`Deducciones mencionadas: ${datos.deducciones}`);
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  }

  return {
    categoria: 'Rate y Condiciones de Pago',
    semaforo,
    hallazgos,
    datos_extraidos: {
      tarifa: datos.tarifa_total ? `$${datos.tarifa_total}` : 'No encontrada',
      por_milla: datos.tarifa_por_milla ? `$${datos.tarifa_por_milla}/mi` : null,
      pago: datos.terminos_pago || 'No especificado',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Negociar tarifa antes de aceptar. Verificar costo operativo.'
      : semaforo === 'amarillo'
      ? 'Revisar términos de pago. Considera Quick Pay si aplica.'
      : 'Tarifa y pago dentro de parámetros aceptables.'
  };
}

function validarCommodity(datos) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.commodity) {
    hallazgos.push('Commodity no especificada en el documento');
    semaforo = 'amarillo';
  } else {
    const commLower = datos.commodity.toLowerCase();
    const incompatible = COMMODITIES_INCOMPATIBLES.find(c => commLower.includes(c));
    if (incompatible) {
      hallazgos.push(`Commodity incompatible con operación estándar: ${datos.commodity}`);
      semaforo = 'rojo';
    } else {
      hallazgos.push(`Commodity: ${datos.commodity}`);
      if (datos.peso) hallazgos.push(`Peso: ${datos.peso}`);
    }
  }

  return {
    categoria: 'Commodity',
    semaforo,
    hallazgos,
    datos_extraidos: {
      commodity: datos.commodity || 'No especificada',
      peso: datos.peso || 'No especificado',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Esta commodity requiere permisos especiales. Verificar con operaciones.'
      : semaforo === 'amarillo'
      ? 'Solicitar clarificación de commodity antes de aceptar.'
      : 'Commodity estándar compatible con operación drayage.'
  };
}

function validarEquipo(datos, trucks) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.tipo_equipo) {
    hallazgos.push('Tipo de equipo/contenedor no especificado');
    semaforo = 'amarillo';
  } else {
    const equipoLower = datos.tipo_equipo.toLowerCase();
    const compatible = EQUIPOS_SOPORTADOS.some(e => equipoLower.includes(e));
    if (!compatible) {
      hallazgos.push(`Equipo requerido posiblemente no disponible: ${datos.tipo_equipo}`);
      semaforo = 'amarillo';
    } else {
      hallazgos.push(`Equipo requerido: ${datos.tipo_equipo}`);
    }
  }

  if (datos.chasis_requerido) {
    const provisto = datos.chasis_provisto_por || 'no especificado';
    if (provisto === 'carrier') {
      hallazgos.push('Chasis requerido por cuenta del CARRIER — costo adicional');
      semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
    } else {
      hallazgos.push(`Chasis provisto por: ${provisto}`);
    }
  }

  if (trucks && trucks.length > 0) {
    const trucksDisponibles = trucks.filter(t => t.estado === 'disponible');
    if (trucksDisponibles.length === 0) {
      hallazgos.push('Sin unidades disponibles en flota actualmente');
      semaforo = 'rojo';
    } else {
      hallazgos.push(`${trucksDisponibles.length} unidad(es) disponible(s) en flota`);
    }
  }

  return {
    categoria: 'Equipo y Chasis',
    semaforo,
    hallazgos,
    datos_extraidos: {
      equipo: datos.tipo_equipo || 'No especificado',
      chasis: datos.chasis_requerido ? `Requerido (por ${datos.chasis_provisto_por || 'no especificado'})` : 'No requerido',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Sin unidades disponibles. No aceptar carga hasta confirmar disponibilidad.'
      : semaforo === 'amarillo'
      ? 'Confirmar disponibilidad de equipo antes de aceptar.'
      : 'Equipo disponible y compatible.'
  };
}

function validarBroker(datos, brokers) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.broker_nombre) {
    hallazgos.push('Nombre del broker no encontrado');
    semaforo = 'amarillo';
  }
  if (!datos.broker_mc) {
    hallazgos.push('MC Number del broker no encontrado — verificar en FMCSA');
    semaforo = 'amarillo';
  }

  // Buscar broker en base de datos
  if (brokers && brokers.length > 0 && datos.broker_nombre) {
    const brokerEncontrado = brokers.find(b =>
      b.nombre.toLowerCase().includes(datos.broker_nombre.toLowerCase()) ||
      datos.broker_nombre.toLowerCase().includes(b.nombre.toLowerCase())
    );

    if (brokerEncontrado) {
      if (brokerEncontrado.estado === 'bloqueado') {
        hallazgos.push(`⛔ BROKER BLOQUEADO en sistema: ${brokerEncontrado.nombre}`);
        semaforo = 'rojo';
      } else if (brokerEncontrado.estado === 'precaucion') {
        hallazgos.push(`⚠ Broker marcado en PRECAUCIÓN: ${brokerEncontrado.nombre}`);
        semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
      } else {
        hallazgos.push(`Broker conocido: ${brokerEncontrado.nombre} — ${brokerEncontrado.cargas_realizadas || 0} cargas previas`);
        if (brokerEncontrado.dias_pago) hallazgos.push(`Historial de pago: ${brokerEncontrado.dias_pago} días promedio`);
        if (brokerEncontrado.puntaje_confiabilidad) {
          if (brokerEncontrado.puntaje_confiabilidad < 5) {
            hallazgos.push(`Puntaje de confiabilidad bajo: ${brokerEncontrado.puntaje_confiabilidad}/10`);
            semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
          }
        }
      }
    } else {
      hallazgos.push('Broker no encontrado en historial — primer contacto');
      semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
    }
  }

  return {
    categoria: 'Broker',
    semaforo,
    hallazgos,
    datos_extraidos: {
      nombre: datos.broker_nombre || 'No encontrado',
      mc: datos.broker_mc || 'No encontrado',
      dot: datos.broker_dot || 'No encontrado',
    },
    recomendacion: semaforo === 'rojo'
      ? 'NO aceptar. Broker bloqueado o con historial negativo.'
      : semaforo === 'amarillo'
      ? 'Verificar MC en FMCSA antes de aceptar. Solicitar referencias.'
      : 'Broker verificado con buen historial.'
  };
}

function validarCarrier(datos, userProfile) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.carrier_nombre) {
    hallazgos.push('Nombre del carrier no encontrado en el documento');
    semaforo = 'amarillo';
  } else {
    const carrierLower = datos.carrier_nombre.toLowerCase();
    if (!carrierLower.includes(CARRIER_NOMBRE)) {
      hallazgos.push(`Carrier en documento: "${datos.carrier_nombre}" — verificar que corresponde a esta operación`);
      semaforo = 'amarillo';
    } else {
      hallazgos.push(`Carrier correcto: ${datos.carrier_nombre}`);
    }
  }

  if (!datos.carrier_mc) {
    hallazgos.push('MC Number del carrier no especificado en documento');
  }

  return {
    categoria: 'Carrier / Larcofer',
    semaforo,
    hallazgos,
    datos_extraidos: {
      nombre: datos.carrier_nombre || 'No encontrado',
      mc: datos.carrier_mc || 'No encontrado',
      dot: datos.carrier_dot || 'No encontrado',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Datos del carrier incorrectos. No firmar sin corregir.'
      : semaforo === 'amarillo'
      ? 'Confirmar que el carrier listado corresponde a esta operación.'
      : 'Datos del carrier verificados correctamente.'
  };
}

function validarFechasOperacion(datos) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.pickup_fecha) {
    hallazgos.push('Fecha de pickup no especificada');
    semaforo = 'amarillo';
  } else {
    hallazgos.push(`Pickup: ${datos.pickup_fecha}${datos.pickup_hora ? ' @ ' + datos.pickup_hora : ''}`);
  }

  if (!datos.delivery_fecha) {
    hallazgos.push('Fecha de entrega no especificada');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  } else {
    hallazgos.push(`Delivery: ${datos.delivery_fecha}${datos.delivery_hora ? ' @ ' + datos.delivery_hora : ''}`);
  }

  if (datos.pickup_fecha && datos.delivery_fecha) {
    const pickup = new Date(datos.pickup_fecha);
    const delivery = new Date(datos.delivery_fecha);
    const horas = (delivery - pickup) / (1000 * 60 * 60);
    if (horas >= 0 && horas < 4 && datos.millas > 100) {
      hallazgos.push(`Ventana de tiempo muy ajustada para ${datos.millas} millas`);
      semaforo = 'rojo';
    }
  }

  if (!datos.origen || !datos.destino) {
    hallazgos.push('Origen o destino incompleto');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  } else {
    hallazgos.push(`Ruta: ${datos.origen} → ${datos.destino}`);
    if (datos.millas) hallazgos.push(`Distancia: ${datos.millas} millas`);
  }

  if (!datos.load_number && !datos.reference_number && !datos.delivery_order_number) {
    hallazgos.push('Sin número de referencia (Load #, Ref # o DO #) — solicitar antes de operar');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  } else {
    if (datos.load_number) hallazgos.push(`Load #: ${datos.load_number}`);
    if (datos.reference_number) hallazgos.push(`Ref #: ${datos.reference_number}`);
    if (datos.delivery_order_number) hallazgos.push(`DO #: ${datos.delivery_order_number}`);
  }

  return {
    categoria: 'Fechas y Operación',
    semaforo,
    hallazgos,
    datos_extraidos: {
      pickup: datos.pickup_fecha || 'No especificado',
      delivery: datos.delivery_fecha || 'No especificado',
      ruta: datos.origen && datos.destino ? `${datos.origen} → ${datos.destino}` : 'No especificada',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Ventana operativa inviable. Rechazar o negociar fechas.'
      : semaforo === 'amarillo'
      ? 'Confirmar tiempos y referencias con broker antes de aceptar.'
      : 'Fechas y referencias completas y viables.'
  };
}

function validarClausulas(datos) {
  const hallazgos = [];
  let semaforo = 'verde';
  const clausulasRiesgo = [];

  const textoCompleto = (datos.clausulas_detectadas || []).join(' ').toLowerCase()
    + ' ' + (datos.penalidades || '').toLowerCase();

  CLAUSULAS_RIESGO.forEach(clausula => {
    if (textoCompleto.includes(clausula)) {
      clausulasRiesgo.push(clausula);
    }
  });

  if (clausulasRiesgo.length > 0) {
    hallazgos.push(`Cláusulas de riesgo detectadas: ${clausulasRiesgo.join(', ')}`);
    semaforo = clausulasRiesgo.length > 2 ? 'rojo' : 'amarillo';
  }

  if (datos.detention_rate) {
    hallazgos.push(`Detention: ${datos.detention_rate}`);
    // Bajo en industria < $50/hr
    const match = datos.detention_rate.match(/\$?(\d+)/);
    if (match && parseInt(match[1]) < 50) {
      hallazgos.push('Tarifa de detention muy baja (< $50/hr)');
      semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
    }
  } else {
    hallazgos.push('Detention rate no especificada — riesgo de tiempo no compensado');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  }

  if (datos.tonu_rate) {
    hallazgos.push(`TONU: ${datos.tonu_rate}`);
  } else {
    hallazgos.push('TONU no mencionado — sin protección por cancelación');
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  }

  if (datos.penalidades) {
    hallazgos.push(`Penalidades: ${datos.penalidades}`);
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  }

  return {
    categoria: 'Cláusulas y Penalidades',
    semaforo,
    hallazgos,
    datos_extraidos: {
      detention: datos.detention_rate || 'No especificada',
      tonu: datos.tonu_rate || 'No especificada',
      penalidades: datos.penalidades || 'Ninguna detectada',
    },
    recomendacion: semaforo === 'rojo'
      ? 'Cláusulas abusivas detectadas. Rechazar o solicitar modificaciones por escrito.'
      : semaforo === 'amarillo'
      ? 'Revisar y negociar cláusulas antes de firmar.'
      : 'Sin cláusulas de riesgo significativas.'
  };
}

// ── Veredicto final ──────────────────────────────────────────────────────────

function calcularVeredicto(categorias, userRole) {
  const rojos = categorias.filter(c => c.semaforo === 'rojo').length;
  const amarillos = categorias.filter(c => c.semaforo === 'amarillo').length;

  let veredicto, semaforo_general, resumen;
  const perspectiva = userRole === 'carrier' ? 'rentabilidad y viabilidad operativa' : 'completitud de datos y asignación';

  if (rojos >= 2) {
    veredicto = 'RECHAZAR';
    semaforo_general = 'rojo';
    resumen = `${rojos} categorías críticas detectadas. Desde la perspectiva de ${perspectiva}, este documento presenta riesgos inaceptables.`;
  } else if (rojos === 1 || amarillos >= 3) {
    veredicto = 'NEGOCIAR';
    semaforo_general = 'amarillo';
    resumen = `Documento requiere revisión. ${rojos > 0 ? `${rojos} alerta crítica` : `${amarillos} puntos de atención`}. Negociar antes de aceptar.`;
  } else if (amarillos >= 1) {
    veredicto = 'NEGOCIAR';
    semaforo_general = 'amarillo';
    resumen = `Documento aceptable con ${amarillos} punto(s) a clarificar. Revisar y confirmar antes de firmar.`;
  } else {
    veredicto = 'FIRMAR';
    semaforo_general = 'verde';
    resumen = `Documento completo y dentro de parámetros operativos. Puede proceder.`;
  }

  const alertas = categorias
    .filter(c => c.semaforo === 'rojo')
    .flatMap(c => c.hallazgos.slice(0, 2));

  const puntos_negociar = categorias
    .filter(c => c.semaforo !== 'verde')
    .map(c => `${c.categoria}: ${c.recomendacion}`);

  return { veredicto, semaforo_general, resumen_ejecutivo: resumen, alertas_criticas: alertas, puntos_negociar };
}

// ── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'No autorizado' }, { status: 401 });

    const { documentText } = await req.json();
    if (!documentText || documentText.trim().length < 20) {
      return Response.json({ error: 'Texto del documento vacío o muy corto' }, { status: 400 });
    }

    // Cargar datos del usuario en paralelo
    const [profiles, costConfigs, trucks, brokers] = await Promise.all([
      base44.entities.UserProfile.filter({ usuario: user.email }),
      base44.entities.CostConfig.filter({ usuario: user.email }),
      base44.entities.Truck.list(),
      base44.entities.Broker.list(),
    ]);

    const userProfile = profiles[0] || null;
    const costConfig = costConfigs[0] || null;
    const userRole = userProfile?.rol || 'dispatcher';

    // Verificar tipo de documento
    const typeCheck = await base44.integrations.Core.InvokeLLM({
      prompt: `Is this text a trucking Rate Confirmation or Delivery Order? Answer ONLY "yes" or "no".\n\n${documentText.slice(0, 400)}`,
    });
    if (typeof typeCheck === 'string' && typeCheck.toLowerCase().trim().startsWith('no')) {
      return Response.json({
        error: 'Solo proceso Rate Confirmations y Delivery Orders. No se aceptan documentos bancarios ni sensibles.'
      }, { status: 400 });
    }

    // Extracción estructurada de datos
    const datos = await extractDocumentData(base44, documentText);

    // Validaciones por reglas
    const categorias = [
      validarRate(datos, costConfig, userRole),
      validarCommodity(datos),
      validarEquipo(datos, trucks),
      validarBroker(datos, brokers),
      validarCarrier(datos, userProfile),
      validarFechasOperacion(datos),
      validarClausulas(datos),
    ];

    // Veredicto
    const { veredicto, semaforo_general, resumen_ejecutivo, alertas_criticas, puntos_negociar } = calcularVeredicto(categorias, userRole);

    return Response.json({
      analysis: {
        resumen_ejecutivo,
        semaforo_general,
        veredicto,
        alertas_criticas,
        puntos_negociar,
        categorias,
        datos_extraidos: datos,
        user_role: userRole,
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});