import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ═══════════════════════════════════════════════════════════════════════════════
// DETECCIÓN SIN IA — Regex sobre el texto crudo
// ═══════════════════════════════════════════════════════════════════════════════

// Palabras clave que confirman que es un documento de transporte
const DOC_KEYWORDS = [
  'rate confirmation', 'rate conf', 'delivery order', 'bill of lading',
  'load confirmation', 'freight', 'carrier', 'shipper', 'consignee',
  'pickup', 'delivery', 'truck', 'drayage', 'intermodal', 'container',
  'mc#', 'mc number', 'dot#', 'driver', 'dispatcher', 'broker',
  'tarifa', 'carga', 'flete', 'conductor', 'origen', 'destino',
];

// Palabras clave que indican documento bancario o sensible — BLOQUEAR
const SENSITIVE_KEYWORDS = [
  'void check', 'voided check', 'bank account', 'routing number', 'account number',
  'checking account', 'wire transfer', 'aba routing', 'ssn', 'social security',
  'tax id', 'ein ', ' ein:', 'w-9', 'w9 form', 'direct deposit form',
  'credit card', 'debit card', 'bank statement', 'cancelled check',
];

function detectarTipoDocumento(text) {
  const lower = text.toLowerCase();

  // Bloquear documentos sensibles (sin IA)
  const esSensible = SENSITIVE_KEYWORDS.some(k => lower.includes(k));
  if (esSensible) return 'blocked';

  // Confirmar documento de transporte
  const esTransporte = DOC_KEYWORDS.filter(k => lower.includes(k)).length >= 2;
  if (esTransporte) return 'transport';

  // Ambiguo — necesita IA
  return 'ambiguous';
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN CON IA — Solo se llama una vez; resultado se cachea por hash
// ═══════════════════════════════════════════════════════════════════════════════

async function extractDocumentData(base44, documentText) {
  return await base44.integrations.Core.InvokeLLM({
    prompt: `You are a data extractor for US intermodal trucking documents (Rate Confirmations and Delivery Orders).
Extract ALL available fields from the document below.
Return null for any field not found. Respond ONLY with valid JSON.

Document:
---
${documentText.slice(0, 4000)}
---`,
    response_json_schema: {
      type: "object",
      properties: {
        tipo_documento:          { type: "string" },
        tarifa_total:            { type: "number" },
        tarifa_por_milla:        { type: "number" },
        terminos_pago:           { type: "string" },
        dias_pago:               { type: "number" },
        factoring_mencionado:    { type: "boolean" },
        deducciones:             { type: "string" },
        descuentos:              { type: "string" },
        commodity:               { type: "string" },
        peso:                    { type: "string" },
        commodity_especial:      { type: "string" },
        tipo_equipo:             { type: "string" },
        tamano_contenedor:       { type: "string" },
        chasis_requerido:        { type: "boolean" },
        chasis_provisto_por:     { type: "string" },
        operacion_tipo:          { type: "string" },
        broker_nombre:           { type: "string" },
        broker_mc:               { type: "string" },
        broker_dot:              { type: "string" },
        broker_telefono:         { type: "string" },
        carrier_nombre:          { type: "string" },
        carrier_mc:              { type: "string" },
        carrier_dot:             { type: "string" },
        pickup_fecha:            { type: "string" },
        pickup_hora:             { type: "string" },
        delivery_fecha:          { type: "string" },
        delivery_hora:           { type: "string" },
        appointment_window:      { type: "string" },
        origen:                  { type: "string" },
        destino:                 { type: "string" },
        millas:                  { type: "number" },
        load_number:             { type: "string" },
        reference_number:        { type: "string" },
        delivery_order_number:   { type: "string" },
        clausulas_detectadas:    { type: "array", items: { type: "string" } },
        detention_rate:          { type: "string" },
        detention_free_time:     { type: "string" },
        tonu_rate:               { type: "string" },
        demurrage:               { type: "string" },
        per_diem:                { type: "string" },
        penalidades:             { type: "string" },
        fee_deductions:          { type: "string" },
        responsabilidad_carrier: { type: "string" },
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGLAS DE VALIDACIÓN — Sin IA; compara datos extraídos vs perfiles guardados
// ═══════════════════════════════════════════════════════════════════════════════

function validarRate(datos, costConfig) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.tarifa_total) {
    hallazgos.push('❌ No se encontró tarifa total en el documento');
    semaforo = 'rojo';
  } else {
    hallazgos.push(`✓ Tarifa total: $${datos.tarifa_total.toLocaleString()}`);

    if (costConfig) {
      // Usar datos de CostConfig directamente — sin IA
      const minimo = costConfig.tarifa_break_even || ((costConfig.costo_por_milla || 0) * 1.05);
      const objetivo = costConfig.tarifa_objetivo || 3.0;

      if (datos.tarifa_por_milla) {
        if (minimo > 0 && datos.tarifa_por_milla < minimo) {
          hallazgos.push(`❌ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi por debajo del mínimo ($${minimo.toFixed(2)}/mi) — operación en pérdida`);
          semaforo = 'rojo';
        } else if (datos.tarifa_por_milla < objetivo) {
          hallazgos.push(`⚠ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi por debajo del objetivo ($${objetivo}/mi)`);
          if (semaforo === 'verde') semaforo = 'amarillo';
        } else {
          hallazgos.push(`✓ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi dentro del objetivo ($${objetivo}/mi)`);
        }
      } else if (datos.millas && datos.millas > 0) {
        // Calcular tarifa/milla desde tarifa total si no viene explícita
        const calculada = datos.tarifa_total / datos.millas;
        if (minimo > 0 && calculada < minimo) {
          hallazgos.push(`❌ Tarifa calculada $${calculada.toFixed(2)}/mi por debajo del mínimo ($${minimo.toFixed(2)}/mi)`);
          semaforo = 'rojo';
        } else {
          hallazgos.push(`✓ Tarifa estimada: $${calculada.toFixed(2)}/mi (${datos.millas} millas)`);
        }
      }
    } else {
      hallazgos.push('⚠ Sin configuración de costos — configura tu Calculadora para comparar tarifas');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  }

  if (!datos.terminos_pago) {
    hallazgos.push('⚠ Términos de pago no especificados');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const dias = datos.dias_pago;
    if (dias && dias > 45) {
      hallazgos.push(`⚠ Pago a ${dias} días — riesgo de flujo de caja`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else if (dias && dias > 30) {
      hallazgos.push(`⚠ Pago a ${dias} días — considerar factoring`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Términos de pago: ${datos.terminos_pago}`);
    }
    if (datos.factoring_mencionado) {
      hallazgos.push('⚠ Factoring mencionado — verificar descuento aplicado');
    }
  }

  if (!datos.detention_rate) {
    hallazgos.push('⚠ Detention rate no especificada — riesgo de tiempo sin compensación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const m = datos.detention_rate.match(/\$?(\d+)/);
    if (m && parseInt(m[1]) < 50) {
      hallazgos.push(`⚠ Detention muy baja: ${datos.detention_rate} (mínimo recomendado: $50-75/hr)`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Detention: ${datos.detention_rate}`);
    }
  }

  if (!datos.tonu_rate) {
    hallazgos.push('⚠ TONU no especificado — sin protección por cancelación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ TONU: ${datos.tonu_rate}`);
  }

  if (datos.deducciones || datos.descuentos) {
    hallazgos.push(`⚠ Descuentos/deducciones detectados: ${datos.deducciones || datos.descuentos} — revisar impacto`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  return {
    categoria: 'Rate y Condiciones de Pago',
    semaforo,
    hallazgos,
    datos_extraidos: {
      tarifa: datos.tarifa_total ? `$${datos.tarifa_total.toLocaleString()}` : 'No encontrada',
      por_milla: datos.tarifa_por_milla ? `$${datos.tarifa_por_milla}/mi` : 'No calculada',
      pago: datos.terminos_pago || 'No especificado',
      detention: datos.detention_rate || 'No especificada',
      tonu: datos.tonu_rate || 'No especificado',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar hasta corregir — tarifa o condiciones inaceptables'
      : semaforo === 'amarillo' ? 'Negociar términos antes de aceptar'
      : 'Aceptar — tarifa y condiciones de pago correctas',
  };
}

function validarCommodity(datos, carrierProfile) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.commodity) {
    hallazgos.push('⚠ Commodity no especificada en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const commLower = datos.commodity.toLowerCase();
    hallazgos.push(`✓ Commodity: ${datos.commodity}`);
    if (datos.peso) hallazgos.push(`✓ Peso: ${datos.peso}`);

    const vagos = ['general cargo', 'freight', 'merchandise', 'goods', 'misc'];
    if (vagos.some(v => commLower === v || commLower === v + '.')) {
      hallazgos.push('⚠ Commodity muy genérica — solicitar descripción específica');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }

    // Comparar contra capacidades del CarrierProfile (datos estructurados, sin IA)
    const especiales = [
      { keyword: 'hazmat', campo: 'hazmat_allowed', label: 'HAZMAT' },
      { keyword: 'reefer', campo: 'reefer_allowed', label: 'Refrigerado' },
      { keyword: 'refrigerated', campo: 'reefer_allowed', label: 'Refrigerado' },
      { keyword: 'overweight', campo: 'overweight_allowed', label: 'Sobrepeso' },
      { keyword: 'oversize', campo: 'overweight_allowed', label: 'Sobredimensionado' },
    ];
    especiales.forEach(({ keyword, campo, label }) => {
      const requiere = commLower.includes(keyword) || (datos.commodity_especial || '').toLowerCase().includes(keyword);
      if (requiere) {
        if (carrierProfile && !carrierProfile[campo]) {
          hallazgos.push(`❌ Commodity requiere ${label} — carrier NO tiene esta capacidad habilitada`);
          semaforo = 'rojo';
        } else if (!carrierProfile) {
          hallazgos.push(`⚠ Commodity requiere ${label} — verificar capacidad del carrier`);
          if (semaforo === 'verde') semaforo = 'amarillo';
        } else {
          hallazgos.push(`✓ Carrier habilitado para ${label}`);
        }
      }
    });

    // Verificar restricciones del carrier (datos estructurados del onboarding)
    if (carrierProfile?.commodity_restrictions?.length > 0) {
      const restringida = carrierProfile.commodity_restrictions.find(r =>
        commLower.includes(r.toLowerCase()) || r.toLowerCase().includes(commLower)
      );
      if (restringida) {
        hallazgos.push(`❌ Commodity "${datos.commodity}" está RESTRINGIDA en el perfil del carrier`);
        semaforo = 'rojo';
      }
    }

    if (datos.tipo_equipo) {
      const equLower = datos.tipo_equipo.toLowerCase();
      if (commLower.includes('reefer') && !equLower.includes('reefer')) {
        hallazgos.push('⚠ Commodity refrigerada pero equipo no parece reefer — verificar');
        if (semaforo === 'verde') semaforo = 'amarillo';
      }
    }
  }

  return {
    categoria: 'Commodity',
    semaforo,
    hallazgos,
    datos_extraidos: {
      commodity: datos.commodity || 'No especificada',
      peso: datos.peso || 'No especificado',
      especial: datos.commodity_especial || 'Ninguna',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar — commodity incompatible con la operación'
      : semaforo === 'amarillo' ? 'Revisar antes de aceptar — commodity requiere confirmación'
      : 'Aceptar — commodity estándar y compatible',
  };
}

function validarEquipo(datos, trucks, carrierProfile) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.tipo_equipo && !datos.tamano_contenedor) {
    hallazgos.push('⚠ Tipo de equipo/contenedor no especificado en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const equipo = datos.tipo_equipo || datos.tamano_contenedor;
    hallazgos.push(`✓ Equipo requerido: ${equipo}`);

    // Comparar contra equipment_types del CarrierProfile (onboarding)
    if (carrierProfile?.equipment_types?.length > 0) {
      const equipoLower = equipo.toLowerCase();
      const compatible = carrierProfile.equipment_types.some(e =>
        equipoLower.includes(e.toLowerCase()) || e.toLowerCase().includes(equipoLower.replace(/ft|'/g, ''))
      );
      if (!compatible) {
        hallazgos.push(`❌ Equipo "${equipo}" no está en los tipos del carrier: ${carrierProfile.equipment_types.join(', ')}`);
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ Equipo compatible con perfil del carrier`);
      }
    }
  }

  if (datos.operacion_tipo) {
    const opLower = datos.operacion_tipo.toLowerCase();
    if (opLower.includes('power only')) {
      if (carrierProfile && !carrierProfile.power_only_allowed) {
        hallazgos.push('❌ Operación Power Only — carrier no tiene esta opción habilitada');
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ Operación Power Only confirmada`);
      }
    } else {
      hallazgos.push(`✓ Tipo de operación: ${datos.operacion_tipo}`);
    }
  }

  if (datos.chasis_requerido) {
    const provisto = datos.chasis_provisto_por || 'no especificado';
    if (provisto.toLowerCase().includes('carrier')) {
      hallazgos.push('⚠ Chasis por cuenta del CARRIER — costo adicional no incluido en tarifa');
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Chasis provisto por: ${provisto}`);
    }
    if (carrierProfile?.chassis_types?.length > 0) {
      hallazgos.push(`✓ Carrier tiene chasis: ${carrierProfile.chassis_types.join(', ')}`);
    }
  }

  if (trucks?.length > 0) {
    const disponibles = trucks.filter(t => t.estado === 'disponible');
    if (disponibles.length === 0) {
      hallazgos.push('❌ No hay unidades disponibles en la flota actualmente');
      semaforo = 'rojo';
    } else {
      hallazgos.push(`✓ ${disponibles.length} unidad(es) disponible(s) en flota`);
    }
  }

  return {
    categoria: 'Equipo y Chasis',
    semaforo,
    hallazgos,
    datos_extraidos: {
      equipo: datos.tipo_equipo || datos.tamano_contenedor || 'No especificado',
      operacion: datos.operacion_tipo || 'No especificada',
      chasis: datos.chasis_requerido ? `Requerido (${datos.chasis_provisto_por || 'no especificado'})` : 'No requerido',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar — equipo o chasis incompatible'
      : semaforo === 'amarillo' ? 'Revisar antes de aceptar — confirmar disponibilidad de equipo'
      : 'Aceptar — equipo disponible y compatible',
  };
}

function validarBroker(datos, brokers, brokerProfiles) {
  const hallazgos = [];
  let semaforo = 'verde';

  if (!datos.broker_nombre) {
    hallazgos.push('⚠ Nombre del broker no encontrado en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }
  if (!datos.broker_mc) {
    hallazgos.push('⚠ MC Number del broker no encontrado — verificar en FMCSA.dot.gov');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Prioridad 1: BrokerProfile del onboarding (comparación de strings, sin IA)
  let perfilEncontrado = null;
  if (brokerProfiles?.length > 0 && datos.broker_nombre) {
    const docLower = datos.broker_nombre.toLowerCase();
    perfilEncontrado = brokerProfiles.find(bp => {
      const legal = (bp.legal_name || '').toLowerCase();
      const display = (bp.display_name || '').toLowerCase();
      return docLower.includes(legal) || legal.includes(docLower)
        || docLower.includes(display) || display.includes(docLower);
    });
  }

  if (perfilEncontrado) {
    hallazgos.push(`✓ Broker identificado en perfil: ${perfilEncontrado.legal_name}`);
    if (datos.broker_mc && perfilEncontrado.mc_number) {
      const docMC = datos.broker_mc.replace(/\D/g, '');
      const perfilMC = perfilEncontrado.mc_number.replace(/\D/g, '');
      if (docMC !== perfilMC) {
        hallazgos.push(`❌ MC del documento (${datos.broker_mc}) NO coincide con perfil (${perfilEncontrado.mc_number})`);
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ MC verificado: ${datos.broker_mc}`);
      }
    }
    if (perfilEncontrado.reliability_score) {
      if (perfilEncontrado.reliability_score < 5) {
        hallazgos.push(`⚠ Confiabilidad baja: ${perfilEncontrado.reliability_score}/10`);
        if (semaforo === 'verde') semaforo = 'amarillo';
      } else {
        hallazgos.push(`✓ Confiabilidad: ${perfilEncontrado.reliability_score}/10`);
      }
    }
    if (perfilEncontrado.notes) hallazgos.push(`ℹ ${perfilEncontrado.notes}`);

  } else {
    // Prioridad 2: Broker legacy (entity Broker)
    const legacy = (brokers || []).find(b =>
      datos.broker_nombre &&
      ((b.nombre || '').toLowerCase().includes(datos.broker_nombre.toLowerCase()) ||
       datos.broker_nombre.toLowerCase().includes((b.nombre || '').toLowerCase()))
    );
    if (legacy) {
      if (legacy.estado === 'bloqueado') {
        hallazgos.push(`❌ BROKER BLOQUEADO: ${legacy.nombre}`);
        semaforo = 'rojo';
      } else if (legacy.estado === 'precaucion') {
        hallazgos.push(`⚠ Broker en PRECAUCIÓN: ${legacy.nombre}`);
        if (semaforo === 'verde') semaforo = 'amarillo';
      } else {
        hallazgos.push(`✓ Broker conocido: ${legacy.nombre} — ${legacy.cargas_realizadas || 0} cargas`);
        if (legacy.puntaje_confiabilidad && legacy.puntaje_confiabilidad < 5) {
          hallazgos.push(`⚠ Confiabilidad baja: ${legacy.puntaje_confiabilidad}/10`);
          if (semaforo === 'verde') semaforo = 'amarillo';
        }
      }
    } else if (datos.broker_nombre) {
      hallazgos.push('⚠ Broker no encontrado en historial — primer contacto, verificar credenciales');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
    if (datos.broker_mc) {
      hallazgos.push(`ℹ Sin perfil local para MC ${datos.broker_mc} — verificar en FMCSA`);
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
    recomendacion: semaforo === 'rojo' ? 'No aceptar — broker bloqueado o MC inconsistente'
      : semaforo === 'amarillo' ? 'Verificar MC en FMCSA y confirmar historial'
      : 'Aceptar — broker verificado con buen historial',
  };
}

function validarCarrier(datos, carrierProfile) {
  const hallazgos = [];
  let semaforo = 'verde';
  let identity_match = 'not_found';

  if (!datos.carrier_nombre) {
    hallazgos.push('⚠ Nombre del carrier no encontrado en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else if (carrierProfile) {
    const docLower = datos.carrier_nombre.toLowerCase();
    const cpLower = (carrierProfile.company_name || '').toLowerCase();
    const tradeLower = (carrierProfile.trade_name || '').toLowerCase();

    // Comparación de strings — sin IA
    const nameMatch = docLower.includes(cpLower) || cpLower.includes(docLower)
      || (tradeLower && (docLower.includes(tradeLower) || tradeLower.includes(docLower)));
    const mcMatch = datos.carrier_mc && carrierProfile.mc_number
      && datos.carrier_mc.replace(/\D/g, '') === carrierProfile.mc_number.replace(/\D/g, '');
    const dotMatch = datos.carrier_dot && carrierProfile.dot_number
      && datos.carrier_dot.replace(/\D/g, '') === carrierProfile.dot_number.replace(/\D/g, '');

    if (nameMatch && (mcMatch || !datos.carrier_mc)) {
      hallazgos.push(`✓ Carrier verificado: ${carrierProfile.company_name}`);
      if (mcMatch) hallazgos.push(`✓ MC coincide: ${datos.carrier_mc}`);
      if (dotMatch) hallazgos.push(`✓ DOT coincide: ${datos.carrier_dot}`);
      identity_match = 'matched';
    } else if (nameMatch && datos.carrier_mc && !mcMatch) {
      hallazgos.push(`❌ Nombre coincide pero MC no: documento=${datos.carrier_mc} vs perfil=${carrierProfile.mc_number}`);
      semaforo = 'rojo';
      identity_match = 'mismatch';
    } else {
      hallazgos.push(`❌ Carrier en documento "${datos.carrier_nombre}" no coincide con "${carrierProfile.company_name}"`);
      semaforo = 'rojo';
      identity_match = 'mismatch';
    }

    if (datos.carrier_dot && carrierProfile.dot_number && !dotMatch) {
      hallazgos.push(`⚠ DOT documento (${datos.carrier_dot}) vs perfil (${carrierProfile.dot_number})`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  } else {
    hallazgos.push(`⚠ Carrier "${datos.carrier_nombre}" detectado — sin perfil registrado para comparar`);
    if (semaforo === 'verde') semaforo = 'amarillo';
    identity_match = 'pending';
  }

  if (!datos.carrier_mc) hallazgos.push('⚠ MC del carrier no especificado en documento');

  return {
    categoria: 'Carrier / Identidad',
    semaforo,
    identity_match,
    hallazgos,
    datos_extraidos: {
      nombre: datos.carrier_nombre || 'No encontrado',
      mc: datos.carrier_mc || 'No encontrado',
      dot: datos.carrier_dot || 'No encontrado',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar — identidad del carrier incorrecta'
      : semaforo === 'amarillo' ? 'Confirmar identidad del carrier antes de aceptar'
      : 'Aceptar — identidad del carrier verificada correctamente',
  };
}

function validarFechasOperacion(datos) {
  const hallazgos = [];
  let semaforo = 'verde';
  const hoy = new Date();

  if (!datos.pickup_fecha) {
    hallazgos.push('⚠ Fecha de pickup no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const pickup = new Date(datos.pickup_fecha);
    if (!isNaN(pickup) && pickup < hoy && (hoy - pickup) / 86400000 > 1) {
      hallazgos.push(`❌ Fecha de pickup ya pasó: ${datos.pickup_fecha}`);
      semaforo = 'rojo';
    } else {
      hallazgos.push(`✓ Pickup: ${datos.pickup_fecha}${datos.pickup_hora ? ' @ ' + datos.pickup_hora : ''}`);
    }
  }

  if (!datos.delivery_fecha) {
    hallazgos.push('⚠ Fecha de entrega no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ Delivery: ${datos.delivery_fecha}${datos.delivery_hora ? ' @ ' + datos.delivery_hora : ''}`);
  }

  if (datos.pickup_fecha && datos.delivery_fecha) {
    const pickup = new Date(datos.pickup_fecha);
    const delivery = new Date(datos.delivery_fecha);
    const horas = (delivery - pickup) / 3600000;
    if (!isNaN(horas)) {
      if (delivery < pickup) {
        hallazgos.push('❌ Fecha de entrega es anterior al pickup — error en el documento');
        semaforo = 'rojo';
      } else if (horas < 4 && datos.millas && datos.millas > 100) {
        hallazgos.push(`❌ Ventana de ${horas.toFixed(0)}h para ${datos.millas} millas — inviable`);
        semaforo = 'rojo';
      }
    }
  }

  if (datos.appointment_window) {
    hallazgos.push(`✓ Appointment window: ${datos.appointment_window}`);
  } else {
    hallazgos.push('⚠ Appointment window no especificada — posibles esperas sin compensación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (!datos.origen || !datos.destino) {
    hallazgos.push('⚠ Origen o destino incompleto');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ Ruta: ${datos.origen} → ${datos.destino}`);
    if (datos.millas) hallazgos.push(`✓ Distancia: ${datos.millas} millas`);
  }

  const tieneRef = datos.load_number || datos.reference_number || datos.delivery_order_number;
  if (!tieneRef) {
    hallazgos.push('⚠ Sin número de referencia — solicitar antes de operar');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    if (datos.load_number) hallazgos.push(`✓ Load #: ${datos.load_number}`);
    if (datos.reference_number) hallazgos.push(`✓ Ref #: ${datos.reference_number}`);
    if (datos.delivery_order_number) hallazgos.push(`✓ DO #: ${datos.delivery_order_number}`);
  }

  return {
    categoria: 'Fechas y Operación',
    semaforo,
    hallazgos,
    datos_extraidos: {
      pickup: datos.pickup_fecha || 'No especificado',
      delivery: datos.delivery_fecha || 'No especificado',
      ruta: datos.origen && datos.destino ? `${datos.origen} → ${datos.destino}` : 'No especificada',
      referencias: [datos.load_number, datos.reference_number, datos.delivery_order_number].filter(Boolean).join(', ') || 'Ninguna',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar — fechas imposibles o referencias ausentes'
      : semaforo === 'amarillo' ? 'Confirmar tiempos y referencias con el broker'
      : 'Aceptar — fechas y referencias completas y viables',
  };
}

const CLAUSULAS_ABUSIVAS = [
  'double broker', 'double-broker', 're-broker',
  'back charge', 'chargeback', 'charge-back',
  'late penalty', 'liquidated damages',
  'all risk', 'full liability',
  'no tonu', 'tonu not applicable',
  'carrier responsible for lumper',
  'carrier pays for', 'carrier liable for all',
  'unlimited liability', 'unconditional guarantee',
];

function validarClausulas(datos) {
  const hallazgos = [];
  let semaforo = 'verde';

  const textoBase = [
    ...(datos.clausulas_detectadas || []),
    datos.penalidades || '',
    datos.fee_deductions || '',
    datos.responsabilidad_carrier || '',
  ].join(' ').toLowerCase();

  // Detección de cláusulas abusivas por keywords — sin IA
  const encontradas = CLAUSULAS_ABUSIVAS.filter(c => textoBase.includes(c));
  if (encontradas.length >= 2) {
    hallazgos.push(`❌ Múltiples cláusulas de riesgo: ${encontradas.join(', ')}`);
    semaforo = 'rojo';
  } else if (encontradas.length === 1) {
    hallazgos.push(`⚠ Cláusula de riesgo detectada: ${encontradas[0]}`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (!datos.detention_rate) {
    hallazgos.push('⚠ Detention no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const m = datos.detention_rate.match(/\$?(\d+)/);
    if (m && parseInt(m[1]) < 50) {
      hallazgos.push(`⚠ Detention baja: ${datos.detention_rate} (estándar: $50-75/hr)`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Detention: ${datos.detention_rate}${datos.detention_free_time ? ' | Free: ' + datos.detention_free_time : ''}`);
    }
  }

  if (datos.demurrage) {
    hallazgos.push(`⚠ Demurrage: ${datos.demurrage} — verificar quién asume el costo`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (datos.per_diem) {
    hallazgos.push(`⚠ Per diem: ${datos.per_diem} — revisar responsabilidad`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (!datos.tonu_rate) {
    hallazgos.push('⚠ TONU no mencionado — sin protección por cancelación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ TONU: ${datos.tonu_rate}`);
  }

  if (datos.fee_deductions) {
    hallazgos.push(`⚠ Fee deductions detectadas: ${datos.fee_deductions}`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (datos.responsabilidad_carrier) {
    const excesiva = ['unlimited', 'unconditional', 'all damage', 'full liability', 'any and all']
      .some(k => datos.responsabilidad_carrier.toLowerCase().includes(k));
    if (excesiva) {
      hallazgos.push(`❌ Cláusula de responsabilidad excesiva del carrier detectada`);
      semaforo = 'rojo';
    } else {
      hallazgos.push(`⚠ Responsabilidad del carrier: ${datos.responsabilidad_carrier} — revisar alcance`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  }

  if (datos.penalidades) {
    hallazgos.push(`⚠ Penalidades: ${datos.penalidades}`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (hallazgos.length === 0) hallazgos.push('✓ Sin cláusulas de riesgo detectadas');

  return {
    categoria: 'Cláusulas y Penalidades',
    semaforo,
    hallazgos,
    datos_extraidos: {
      detention: datos.detention_rate || 'No especificada',
      tonu: datos.tonu_rate || 'No especificado',
      demurrage: datos.demurrage || 'No mencionado',
      per_diem: datos.per_diem || 'No mencionado',
      penalidades: datos.penalidades || 'Ninguna',
    },
    recomendacion: semaforo === 'rojo' ? 'No aceptar — cláusulas abusivas o responsabilidad excesiva'
      : semaforo === 'amarillo' ? 'Negociar — revisar cláusulas antes de firmar'
      : 'Aceptar — cláusulas dentro de parámetros normales',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VEREDICTO FINAL — Lógica pura, sin IA
// ═══════════════════════════════════════════════════════════════════════════════

function calcularVeredicto(categorias, userRole) {
  const rojos = categorias.filter(c => c.semaforo === 'rojo').length;
  const amarillos = categorias.filter(c => c.semaforo === 'amarillo').length;
  const perspectiva = userRole === 'carrier' ? 'rentabilidad y viabilidad operativa' : 'completitud y asignación';

  let veredicto, semaforo_general, resumen;

  if (rojos >= 2) {
    veredicto = 'No aceptar hasta corregir';
    semaforo_general = 'rojo';
    resumen = `${rojos} categorías críticas. El documento tiene riesgos inaceptables desde la perspectiva de ${perspectiva}.`;
  } else if (rojos === 1) {
    veredicto = 'No aceptar hasta corregir';
    semaforo_general = 'rojo';
    resumen = `Alerta crítica en "${categorias.find(c => c.semaforo === 'rojo')?.categoria}". Debe corregirse antes de proceder.`;
  } else if (amarillos >= 3) {
    veredicto = 'Negociar';
    semaforo_general = 'amarillo';
    resumen = `${amarillos} puntos de atención. Varias condiciones requieren negociación antes de aceptar.`;
  } else if (amarillos >= 1) {
    veredicto = 'Revisar antes de aceptar';
    semaforo_general = 'amarillo';
    resumen = `${amarillos} punto(s) a confirmar. Revisar con broker antes de firmar.`;
  } else {
    veredicto = 'Aceptar';
    semaforo_general = 'verde';
    resumen = `Documento completo y dentro de parámetros operativos. Puede proceder.`;
  }

  const alertas_criticas = categorias
    .filter(c => c.semaforo === 'rojo')
    .flatMap(c => c.hallazgos.filter(h => h.startsWith('❌')).slice(0, 2));

  const puntos_negociar = categorias
    .filter(c => c.semaforo !== 'verde')
    .map(c => `${c.categoria}: ${c.recomendacion}`);

  return { veredicto, semaforo_general, resumen_ejecutivo: resumen, alertas_criticas, puntos_negociar };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

// Versión del motor de reglas — incrementar manualmente cuando cambien las reglas de validación
const RULES_VERSION = '2.0.0';

async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.slice(0, 1000));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Genera un fingerprint corto (8 chars) para comparar versiones de configuración
async function fingerprintObject(obj) {
  if (!obj) return 'none';
  const str = JSON.stringify(obj);
  return (await hashText(str)).slice(0, 8);
}

function calcularConfidence(datos) {
  const campos = [
    datos.tarifa_total, datos.terminos_pago, datos.commodity, datos.tipo_equipo,
    datos.broker_nombre, datos.broker_mc, datos.carrier_nombre,
    datos.pickup_fecha, datos.delivery_fecha,
    datos.load_number || datos.reference_number || datos.delivery_order_number,
  ].filter(Boolean).length;
  return Math.round((campos / 10) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// Flujo: hash → caché → detección sin IA → extracción IA → reglas → guardar
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'No autorizado' }, { status: 401 });

    const { documentText, selectedCarrierId } = await req.json();
    if (!documentText || documentText.trim().length < 20) {
      return Response.json({ error: 'Texto del documento vacío o muy corto' }, { status: 400 });
    }

    // ── PASO 1: Detección por keywords — sin IA ────────────────────────────────
    const tipoDetectado = detectarTipoDocumento(documentText);

    if (tipoDetectado === 'blocked') {
      return Response.json({
        error: 'Este tipo de documento no se puede analizar por razones de seguridad. Solo proceso Rate Confirmations y Delivery Orders.'
      }, { status: 400 });
    }

    // ── PASO 2: Hash del documento — si ya existe, devolver resultado cacheado ──
    const [docHash, contextData] = await Promise.all([
      hashText(documentText),
      Promise.all([
        base44.entities.UserProfile.filter({ usuario: user.email }),
        base44.entities.CostConfig.filter({ usuario: user.email }),
        base44.entities.Truck.list(),
        base44.entities.Broker.list(),
        base44.entities.CarrierProfile.filter({ active: true }),
        base44.entities.DispatcherProfile.filter({ user_id: user.email }),
        base44.entities.BrokerProfile.filter({ active: true }),
      ])
    ]);

    const [profiles, costConfigs, trucks, brokers, carrierProfiles, dispatcherProfiles, brokerProfiles] = contextData;

    // ── PASO 3: Resolver contexto del usuario ─────────────────────────────────
    const userProfile = profiles[0] || null;
    const costConfig = costConfigs[0] || null;
    const userRole = userProfile?.rol || 'dispatcher';
    const dispatcherProfile = dispatcherProfiles[0] || null;

    let carrierProfile = null;
    if (selectedCarrierId) carrierProfile = carrierProfiles.find(c => c.id === selectedCarrierId) || null;
    if (!carrierProfile && dispatcherProfile?.default_carrier) carrierProfile = carrierProfiles.find(c => c.id === dispatcherProfile.default_carrier) || null;
    if (!carrierProfile) carrierProfile = carrierProfiles[0] || null;

    // ── PASO 3b: Calcular fingerprints de versión de configuración ────────────
    const [costVer, carrierVer, brokerVer] = await Promise.all([
      fingerprintObject(costConfig),
      fingerprintObject(carrierProfile),
      fingerprintObject(brokerProfiles),
    ]);

    // ── PASO 3c: Buscar resultado previo por hash + versiones ─────────────────
    // Solo reusar si doc + usuario + reglas + configuraciones coinciden exactamente
    const previos = await base44.entities.DocumentVerification.filter({ document_hash: docHash, uploaded_by: user.email });
    if (previos.length > 0) {
      const prev = previos[0];
      const cacheValido =
        prev.verification_summary &&
        prev.recommended_action &&
        prev.rules_version === RULES_VERSION &&
        prev.cost_config_version === costVer &&
        prev.carrier_profile_version === carrierVer &&
        prev.broker_profile_version === brokerVer;

      if (cacheValido) {
        return Response.json({
          cached: true,
          cache_reason: 'Documento ya procesado con la configuración actual',
          analysis: {
            resumen_ejecutivo: prev.verification_summary,
            semaforo_general: prev.overall_risk,
            veredicto: prev.recommended_action,
            alertas_criticas: [],
            puntos_negociar: [],
            categorias: [],
            datos_extraidos: {
              broker_nombre: prev.broker_name_detected,
              broker_mc: prev.broker_mc_detected,
              carrier_nombre: prev.carrier_name_detected,
              carrier_mc: prev.carrier_mc_detected,
              commodity: prev.commodity_detected,
              tipo_equipo: prev.equipment_detected,
              tarifa_total: prev.rate_total_detected,
              terminos_pago: prev.payment_terms_detected,
              pickup_fecha: prev.pickup_detected,
              delivery_fecha: prev.delivery_detected,
              reference_number: prev.reference_number_detected,
              load_number: prev.load_number_detected,
              tipo_documento: prev.document_type,
            },
            user_role: userRole,
            confidence_score: prev.confidence_score,
            carrier_profile_used: carrierProfile?.company_name || null,
            foco_analisis: `Resultado cacheado — analizado el ${new Date(prev.analyzed_at || prev.created_date).toLocaleDateString('es-US')}`,
            analyzed_at: prev.analyzed_at || prev.created_date,
            analysis_source: 'cache',
          }
        });
      }
      // Si el caché existe pero está desactualizado, se ignora y se reprocesa
    }

    // ── PASO 4: Si el texto es ambiguo, verificar con IA si es documento válido ─
    if (tipoDetectado === 'ambiguous') {
      const typeCheck = await base44.integrations.Core.InvokeLLM({
        prompt: `Is this text a trucking Rate Confirmation or Delivery Order? Answer ONLY "yes" or "no".\n\n${documentText.slice(0, 400)}`,
      });
      if (typeof typeCheck === 'string' && typeCheck.toLowerCase().trim().startsWith('no')) {
        return Response.json({
          error: 'Solo proceso Rate Confirmations y Delivery Orders. No se aceptan documentos bancarios ni sensibles.'
        }, { status: 400 });
      }
    }

    // ── PASO 5: Extracción estructurada con IA (única llamada de extracción) ───
    const datos = await extractDocumentData(base44, documentText);

    // ── PASO 6: Validar con reglas puras — sin IA adicional ───────────────────
    const categorias = [
      validarRate(datos, costConfig),
      validarCommodity(datos, carrierProfile),
      validarEquipo(datos, trucks, carrierProfile),
      validarBroker(datos, brokers, brokerProfiles),
      validarCarrier(datos, carrierProfile),
      validarFechasOperacion(datos),
      validarClausulas(datos),
    ];

    // ── PASO 7: Veredicto por reglas ──────────────────────────────────────────
    const { veredicto, semaforo_general, resumen_ejecutivo, alertas_criticas, puntos_negociar } = calcularVeredicto(categorias, userRole);
    const confidence_score = calcularConfidence(datos);

    // ── PASO 8: Guardar resultado estructurado (permite caché futura) ─────────
    const catMap = {};
    categorias.forEach(c => {
      const key = c.categoria.toLowerCase().includes('rate') ? 'rate'
        : c.categoria.toLowerCase().includes('commodity') ? 'commodity'
        : c.categoria.toLowerCase().includes('equipo') ? 'equipment'
        : c.categoria.toLowerCase().includes('broker') ? 'broker'
        : c.categoria.toLowerCase().includes('carrier') ? 'carrier'
        : c.categoria.toLowerCase().includes('fecha') ? 'date'
        : 'clause';
      catMap[key] = c.semaforo;
    });

    const identityResult = categorias.find(c => c.categoria.includes('Carrier'));

    await base44.entities.DocumentVerification.create({
      document_type: datos.tipo_documento || 'rate_confirmation',
      document_hash: docHash,
      uploaded_by: user.email,
      analysis_source: 'new',
      rules_version: RULES_VERSION,
      cost_config_version: costVer,
      carrier_profile_version: carrierVer,
      broker_profile_version: brokerVer,
      analyzed_at: new Date().toISOString(),
      broker_name_detected: datos.broker_nombre || null,
      broker_mc_detected: datos.broker_mc || null,
      broker_dot_detected: datos.broker_dot || null,
      carrier_name_detected: datos.carrier_nombre || null,
      carrier_mc_detected: datos.carrier_mc || null,
      carrier_dot_detected: datos.carrier_dot || null,
      commodity_detected: datos.commodity || null,
      equipment_detected: datos.tipo_equipo || datos.tamano_contenedor || null,
      chassis_detected: datos.chasis_provisto_por || null,
      rate_total_detected: datos.tarifa_total || null,
      detention_detected: datos.detention_rate || null,
      tonu_detected: datos.tonu_rate || null,
      payment_terms_detected: datos.terminos_pago || null,
      pickup_detected: datos.pickup_fecha || null,
      delivery_detected: datos.delivery_fecha || null,
      reference_number_detected: datos.reference_number || null,
      load_number_detected: datos.load_number || null,
      operation_type_detected: datos.delivery_order_number ? 'delivery_order' : 'rate_confirmation',
      identity_match_status: identityResult?.identity_match || 'pending',
      rate_check_status: catMap.rate || 'amarillo',
      commodity_check_status: catMap.commodity || 'amarillo',
      equipment_check_status: catMap.equipment || 'amarillo',
      broker_check_status: catMap.broker || 'amarillo',
      carrier_check_status: catMap.carrier || 'amarillo',
      date_check_status: catMap.date || 'amarillo',
      clause_check_status: catMap.clause || 'amarillo',
      overall_risk: semaforo_general,
      verification_summary: resumen_ejecutivo,
      recommended_action: veredicto,
      confidence_score,
    });

    const foco_analisis = userRole === 'carrier'
      ? 'Enfoque: rentabilidad, cumplimiento operativo y compatibilidad de flota'
      : dispatcherProfile?.dispatch_mode === 'multi_carrier'
      ? `Enfoque: completitud del documento, broker, carrier asignado (${carrierProfile?.company_name || 'no seleccionado'})`
      : `Enfoque: compatibilidad con ${carrierProfile?.company_name || 'carrier'}, completitud y riesgo documental`;

    return Response.json({
      cached: false,
      analysis: {
        resumen_ejecutivo,
        semaforo_general,
        veredicto,
        alertas_criticas,
        puntos_negociar,
        categorias,
        datos_extraidos: datos,
        user_role: userRole,
        dispatch_mode: dispatcherProfile?.dispatch_mode || null,
        confidence_score,
        carrier_profile_used: carrierProfile?.company_name || null,
        foco_analisis,
        analysis_source: 'new',
        analyzed_at: new Date().toISOString(),
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});