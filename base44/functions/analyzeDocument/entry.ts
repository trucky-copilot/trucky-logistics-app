import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Extracción LLM ────────────────────────────────────────────────────────────

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
        tipo_documento:          { type: "string" },
        // Rate y pago
        tarifa_total:            { type: "number" },
        tarifa_por_milla:        { type: "number" },
        terminos_pago:           { type: "string" },
        dias_pago:               { type: "number" },
        factoring_mencionado:    { type: "boolean" },
        deducciones:             { type: "string" },
        descuentos:              { type: "string" },
        // Commodity
        commodity:               { type: "string" },
        peso:                    { type: "string" },
        commodity_especial:      { type: "string" },  // hazmat, reefer, overweight, bonded, etc.
        // Equipo
        tipo_equipo:             { type: "string" },
        tamano_contenedor:       { type: "string" },
        chasis_requerido:        { type: "boolean" },
        chasis_provisto_por:     { type: "string" },
        operacion_tipo:          { type: "string" },  // live_load, drop_hook, power_only
        // Broker
        broker_nombre:           { type: "string" },
        broker_mc:               { type: "string" },
        broker_dot:              { type: "string" },
        broker_telefono:         { type: "string" },
        // Carrier
        carrier_nombre:          { type: "string" },
        carrier_mc:              { type: "string" },
        carrier_dot:             { type: "string" },
        // Fechas y operación
        pickup_fecha:            { type: "string" },
        pickup_hora:             { type: "string" },
        delivery_fecha:          { type: "string" },
        delivery_hora:           { type: "string" },
        appointment_window:      { type: "string" },
        origen:                  { type: "string" },
        destino:                 { type: "string" },
        millas:                  { type: "number" },
        // Referencias
        load_number:             { type: "string" },
        reference_number:        { type: "string" },
        delivery_order_number:   { type: "string" },
        // Cláusulas
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

// ── A. RATE Y CONDICIONES DE PAGO ─────────────────────────────────────────────

function validarRate(datos, costConfig, userRole) {
  const hallazgos = [];
  let semaforo = 'verde';

  // Regla 1: ¿Existe tarifa total?
  if (!datos.tarifa_total) {
    hallazgos.push('❌ No se encontró tarifa total en el documento');
    semaforo = 'rojo';
  } else {
    hallazgos.push(`✓ Tarifa total: $${datos.tarifa_total.toLocaleString()}`);

    // Regla 2: Comparar contra mínimo y objetivo configurados
    if (costConfig) {
      const minimo = costConfig.tarifa_break_even || (costConfig.costo_por_milla * 1.05);
      const objetivo = costConfig.tarifa_objetivo || 3.0;

      if (datos.tarifa_por_milla) {
        if (datos.tarifa_por_milla < minimo) {
          hallazgos.push(`❌ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi ESTÁ POR DEBAJO del mínimo ($${minimo.toFixed(2)}/mi) — operación en pérdida`);
          semaforo = 'rojo';
        } else if (datos.tarifa_por_milla < objetivo) {
          hallazgos.push(`⚠ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi por debajo del objetivo ($${objetivo}/mi)`);
          if (semaforo === 'verde') semaforo = 'amarillo';
        } else {
          hallazgos.push(`✓ Tarifa $${datos.tarifa_por_milla.toFixed(2)}/mi dentro del objetivo`);
        }
      }
    } else {
      hallazgos.push('⚠ Sin configuración de costos — no se puede comparar tarifa vs mínimo');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  }

  // Regla 3: Términos de pago
  if (!datos.terminos_pago) {
    hallazgos.push('⚠ Términos de pago no especificados en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const diasPago = datos.dias_pago;
    if (diasPago && diasPago > 45) {
      hallazgos.push(`⚠ Plazo de pago largo: ${diasPago} días (riesgo de flujo de caja)`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else if (diasPago && diasPago > 30) {
      hallazgos.push(`⚠ Pago a ${diasPago} días — considerar factoring`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Términos de pago: ${datos.terminos_pago}`);
    }
    if (datos.factoring_mencionado) {
      hallazgos.push('⚠ Factoring mencionado — verificar descuento aplicado');
    }
  }

  // Regla 4: Detention ausente
  if (!datos.detention_rate) {
    hallazgos.push('⚠ Detention rate no especificada — riesgo de tiempo sin compensación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const matchDet = datos.detention_rate.match(/\$?(\d+)/);
    if (matchDet && parseInt(matchDet[1]) < 50) {
      hallazgos.push(`⚠ Detention muy baja: ${datos.detention_rate} (industria mínimo $50-75/hr)`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Detention: ${datos.detention_rate}`);
    }
  }

  // Regla 5: TONU
  if (!datos.tonu_rate) {
    hallazgos.push('⚠ TONU no especificado — sin protección por cancelación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ TONU: ${datos.tonu_rate}`);
  }

  // Regla 6: Descuentos y deducciones poco claras
  if (datos.deducciones || datos.descuentos) {
    hallazgos.push(`❌ Descuentos/deducciones detectados: ${datos.deducciones || datos.descuentos} — revisar impacto`);
    semaforo = semaforo === 'verde' ? 'amarillo' : semaforo;
  }

  // Semáforo resumen
  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — tarifa o condiciones inaceptables'
    : semaforo === 'amarillo'
    ? 'Negociar términos antes de aceptar'
    : 'Aceptar — tarifa y condiciones de pago correctas';

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
    recomendacion: accion,
  };
}

// ── B. COMMODITY ──────────────────────────────────────────────────────────────

function validarCommodity(datos, carrierProfile) {
  const hallazgos = [];
  let semaforo = 'verde';

  // Regla 1: ¿Existe commodity?
  if (!datos.commodity) {
    hallazgos.push('⚠ Commodity no especificada en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const commLower = datos.commodity.toLowerCase();
    hallazgos.push(`✓ Commodity: ${datos.commodity}`);
    if (datos.peso) hallazgos.push(`✓ Peso: ${datos.peso}`);

    // Regla 2: ¿Es demasiado vaga?
    const vagos = ['general cargo', 'freight', 'merchandise', 'goods', 'misc'];
    if (vagos.some(v => commLower === v || commLower === v + '.')) {
      hallazgos.push('⚠ Commodity muy genérica — solicitar descripción específica para carga sensible');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }

    // Regla 3: Capacidades especiales requeridas
    const especiales = [
      { keyword: 'hazmat', campo: 'hazmat_allowed', label: 'HAZMAT' },
      { keyword: 'reefer', campo: 'reefer_allowed', label: 'Refrigerado' },
      { keyword: 'refrigerated', campo: 'reefer_allowed', label: 'Refrigerado' },
      { keyword: 'overweight', campo: 'overweight_allowed', label: 'Sobrepeso' },
      { keyword: 'oversize', campo: 'overweight_allowed', label: 'Sobredimensionado' },
    ];
    especiales.forEach(({ keyword, campo, label }) => {
      if (commLower.includes(keyword) || (datos.commodity_especial || '').toLowerCase().includes(keyword)) {
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

    // Regla 4: Commodity en lista de restricciones del carrier
    if (carrierProfile && carrierProfile.commodity_restrictions && carrierProfile.commodity_restrictions.length > 0) {
      const restringida = carrierProfile.commodity_restrictions.find(r =>
        commLower.includes(r.toLowerCase()) || r.toLowerCase().includes(commLower)
      );
      if (restringida) {
        hallazgos.push(`❌ Commodity "${datos.commodity}" está RESTRINGIDA en el perfil del carrier`);
        semaforo = 'rojo';
      }
    }

    // Regla 5: ¿Commodity contradice el equipo?
    if (datos.tipo_equipo) {
      const equLower = datos.tipo_equipo.toLowerCase();
      if (commLower.includes('reefer') && !equLower.includes('reefer')) {
        hallazgos.push('⚠ Commodity refrigerada pero equipo no parece ser reefer — verificar');
        if (semaforo === 'verde') semaforo = 'amarillo';
      }
    }
  }

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — commodity incompatible con la operación'
    : semaforo === 'amarillo'
    ? 'Revisar antes de aceptar — commodity requiere confirmación'
    : 'Aceptar — commodity estándar y compatible';

  return {
    categoria: 'Commodity',
    semaforo,
    hallazgos,
    datos_extraidos: {
      commodity: datos.commodity || 'No especificada',
      peso: datos.peso || 'No especificado',
      especial: datos.commodity_especial || 'Ninguna',
    },
    recomendacion: accion,
  };
}

// ── C. EQUIPO Y CHASIS ────────────────────────────────────────────────────────

function validarEquipo(datos, trucks, carrierProfile) {
  const hallazgos = [];
  let semaforo = 'verde';

  // Regla 1: ¿Existe tipo de equipo?
  if (!datos.tipo_equipo && !datos.tamano_contenedor) {
    hallazgos.push('⚠ Tipo de equipo/contenedor no especificado en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const equipo = datos.tipo_equipo || datos.tamano_contenedor;
    hallazgos.push(`✓ Equipo requerido: ${equipo}`);

    // Regla 2: ¿Carrier tiene ese tipo de equipo?
    if (carrierProfile && carrierProfile.equipment_types && carrierProfile.equipment_types.length > 0) {
      const equipoLower = equipo.toLowerCase();
      const compatible = carrierProfile.equipment_types.some(e =>
        equipoLower.includes(e.toLowerCase()) || e.toLowerCase().includes(equipoLower.replace(/ft|'/, ''))
      );
      if (!compatible) {
        hallazgos.push(`❌ Equipo "${equipo}" NO está en los tipos del carrier (${carrierProfile.equipment_types.join(', ')})`);
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ Equipo compatible con perfil del carrier`);
      }
    }
  }

  // Regla 3: Tipo de operación
  if (datos.operacion_tipo) {
    const opLower = datos.operacion_tipo.toLowerCase();
    if (opLower.includes('power only')) {
      if (carrierProfile && !carrierProfile.power_only_allowed) {
        hallazgos.push('❌ Operación Power Only — carrier no tiene esta opción habilitada');
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ Operación Power Only — confirmada`);
      }
    } else {
      hallazgos.push(`✓ Tipo de operación: ${datos.operacion_tipo}`);
    }
  }

  // Regla 4: Chasis
  if (datos.chasis_requerido) {
    const provisto = datos.chasis_provisto_por || 'no especificado';
    if (provisto === 'carrier' || provisto.includes('carrier')) {
      hallazgos.push('⚠ Chasis por cuenta del CARRIER — costo adicional no incluido en tarifa');
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Chasis provisto por: ${provisto}`);
    }

    // Regla 5: ¿El carrier tiene chasis de ese tipo?
    if (carrierProfile && carrierProfile.chassis_types && carrierProfile.chassis_types.length > 0) {
      hallazgos.push(`✓ Carrier tiene chasis: ${carrierProfile.chassis_types.join(', ')}`);
    }
  }

  // Regla 6: ¿Hay unidades disponibles?
  if (trucks && trucks.length > 0) {
    const disponibles = trucks.filter(t => t.estado === 'disponible');
    if (disponibles.length === 0) {
      hallazgos.push('❌ No hay unidades disponibles en la flota actualmente');
      semaforo = 'rojo';
    } else {
      hallazgos.push(`✓ ${disponibles.length} unidad(es) disponible(s) en flota`);
    }
  }

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — equipo o chasis incompatible con la operación'
    : semaforo === 'amarillo'
    ? 'Revisar antes de aceptar — confirmar disponibilidad de equipo'
    : 'Aceptar — equipo disponible y compatible';

  return {
    categoria: 'Equipo y Chasis',
    semaforo,
    hallazgos,
    datos_extraidos: {
      equipo: datos.tipo_equipo || datos.tamano_contenedor || 'No especificado',
      operacion: datos.operacion_tipo || 'No especificada',
      chasis: datos.chasis_requerido ? `Requerido (por ${datos.chasis_provisto_por || 'no especificado'})` : 'No requerido',
    },
    recomendacion: accion,
  };
}

// ── D. BROKER ─────────────────────────────────────────────────────────────────

function validarBroker(datos, brokers, brokerProfiles) {
  const hallazgos = [];
  let semaforo = 'verde';

  // Regla 1: ¿Existe nombre del broker?
  if (!datos.broker_nombre) {
    hallazgos.push('⚠ Nombre del broker no encontrado en el documento');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 2: ¿Existe MC?
  if (!datos.broker_mc) {
    hallazgos.push('⚠ MC Number del broker no encontrado — verificar en FMCSA.dot.gov');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 3: Buscar en BrokerProfile (nuevo — prioridad)
  let brokerProfileEncontrado = null;
  if (brokerProfiles && brokerProfiles.length > 0 && datos.broker_nombre) {
    brokerProfileEncontrado = brokerProfiles.find(bp => {
      const legal = (bp.legal_name || '').toLowerCase();
      const display = (bp.display_name || '').toLowerCase();
      const doc = datos.broker_nombre.toLowerCase();
      return doc.includes(legal) || legal.includes(doc) || doc.includes(display) || display.includes(doc);
    });
  }

  if (brokerProfileEncontrado) {
    hallazgos.push(`✓ Broker identificado en perfil: ${brokerProfileEncontrado.legal_name}`);

    // Regla 4: Verificar MC coincide
    if (datos.broker_mc && brokerProfileEncontrado.mc_number) {
      const docMC = datos.broker_mc.replace(/\D/g, '');
      const perfilMC = brokerProfileEncontrado.mc_number.replace(/\D/g, '');
      if (docMC !== perfilMC) {
        hallazgos.push(`❌ MC del documento (${datos.broker_mc}) NO coincide con perfil registrado (${brokerProfileEncontrado.mc_number})`);
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ MC verificado: ${datos.broker_mc}`);
      }
    }

    // Regla 5: Puntaje y notas
    if (brokerProfileEncontrado.reliability_score) {
      if (brokerProfileEncontrado.reliability_score < 5) {
        hallazgos.push(`⚠ Confiabilidad baja: ${brokerProfileEncontrado.reliability_score}/10`);
        if (semaforo === 'verde') semaforo = 'amarillo';
      } else {
        hallazgos.push(`✓ Confiabilidad: ${brokerProfileEncontrado.reliability_score}/10`);
      }
    }
    if (brokerProfileEncontrado.notes) {
      hallazgos.push(`ℹ Notas internas: ${brokerProfileEncontrado.notes}`);
    }
  } else {
    // Regla 6: Buscar en Broker (legacy)
    const brokerLegacy = brokers && datos.broker_nombre
      ? brokers.find(b =>
          (b.nombre || '').toLowerCase().includes(datos.broker_nombre.toLowerCase()) ||
          datos.broker_nombre.toLowerCase().includes((b.nombre || '').toLowerCase())
        )
      : null;

    if (brokerLegacy) {
      if (brokerLegacy.estado === 'bloqueado') {
        hallazgos.push(`❌ BROKER BLOQUEADO en sistema: ${brokerLegacy.nombre}`);
        semaforo = 'rojo';
      } else if (brokerLegacy.estado === 'precaucion') {
        hallazgos.push(`⚠ Broker en PRECAUCIÓN: ${brokerLegacy.nombre}`);
        if (semaforo === 'verde') semaforo = 'amarillo';
      } else {
        hallazgos.push(`✓ Broker conocido: ${brokerLegacy.nombre} — ${brokerLegacy.cargas_realizadas || 0} cargas previas`);
        if (brokerLegacy.puntaje_confiabilidad && brokerLegacy.puntaje_confiabilidad < 5) {
          hallazgos.push(`⚠ Confiabilidad baja: ${brokerLegacy.puntaje_confiabilidad}/10`);
          if (semaforo === 'verde') semaforo = 'amarillo';
        }
      }
    } else if (datos.broker_nombre) {
      hallazgos.push('⚠ Broker no encontrado en historial — primer contacto, verificar credenciales');
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  }

  // Regla 7: ¿Nombre contradice MC? (detección básica de inconsistencia)
  if (datos.broker_nombre && datos.broker_mc && !brokerProfileEncontrado) {
    hallazgos.push(`ℹ Sin perfil local para validar MC ${datos.broker_mc} — verificar en FMCSA`);
  }

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — broker bloqueado o con inconsistencia de identidad'
    : semaforo === 'amarillo'
    ? 'Negociar — verificar MC en FMCSA y confirmar historial'
    : 'Aceptar — broker verificado con buen historial';

  return {
    categoria: 'Broker',
    semaforo,
    hallazgos,
    datos_extraidos: {
      nombre: datos.broker_nombre || 'No encontrado',
      mc: datos.broker_mc || 'No encontrado',
      dot: datos.broker_dot || 'No encontrado',
    },
    recomendacion: accion,
  };
}

// ── E. CARRIER / IDENTIDAD ────────────────────────────────────────────────────

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
      hallazgos.push(`❌ Nombre coincide pero MC NO: documento=${datos.carrier_mc} vs perfil=${carrierProfile.mc_number}`);
      semaforo = 'rojo';
      identity_match = 'mismatch';
    } else {
      hallazgos.push(`❌ Carrier en documento: "${datos.carrier_nombre}" NO coincide con: "${carrierProfile.company_name}"`);
      semaforo = 'rojo';
      identity_match = 'mismatch';
    }

    // DOT presente pero no coincide
    if (datos.carrier_dot && carrierProfile.dot_number && !dotMatch) {
      hallazgos.push(`⚠ DOT en documento (${datos.carrier_dot}) no coincide con perfil (${carrierProfile.dot_number})`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  } else {
    hallazgos.push(`⚠ Carrier "${datos.carrier_nombre}" detectado — sin perfil registrado para comparar`);
    if (semaforo === 'verde') semaforo = 'amarillo';
    identity_match = 'pending';
  }

  if (!datos.carrier_mc) hallazgos.push('⚠ MC Number del carrier no especificado en documento');
  if (!datos.carrier_dot) hallazgos.push('ℹ DOT del carrier no mencionado');

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — identidad del carrier incorrecta o inconsistente'
    : semaforo === 'amarillo'
    ? 'Revisar antes de aceptar — confirmar identidad del carrier'
    : 'Aceptar — identidad del carrier verificada correctamente';

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
    recomendacion: accion,
  };
}

// ── F. FECHAS Y OPERACIÓN ─────────────────────────────────────────────────────

function validarFechasOperacion(datos) {
  const hallazgos = [];
  let semaforo = 'verde';
  const hoy = new Date();

  // Regla 1: Pickup
  if (!datos.pickup_fecha) {
    hallazgos.push('⚠ Fecha de pickup no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const pickup = new Date(datos.pickup_fecha);
    if (!isNaN(pickup)) {
      if (pickup < hoy && (hoy - pickup) / (1000 * 60 * 60 * 24) > 1) {
        hallazgos.push(`❌ Fecha de pickup ya pasó: ${datos.pickup_fecha}`);
        semaforo = 'rojo';
      } else {
        hallazgos.push(`✓ Pickup: ${datos.pickup_fecha}${datos.pickup_hora ? ' @ ' + datos.pickup_hora : ''}`);
      }
    } else {
      hallazgos.push(`✓ Pickup: ${datos.pickup_fecha}${datos.pickup_hora ? ' @ ' + datos.pickup_hora : ''}`);
    }
  }

  // Regla 2: Delivery
  if (!datos.delivery_fecha) {
    hallazgos.push('⚠ Fecha de entrega no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ Delivery: ${datos.delivery_fecha}${datos.delivery_hora ? ' @ ' + datos.delivery_hora : ''}`);
  }

  // Regla 3: ¿Ventana viable?
  if (datos.pickup_fecha && datos.delivery_fecha) {
    const pickup = new Date(datos.pickup_fecha);
    const delivery = new Date(datos.delivery_fecha);
    const horas = (delivery - pickup) / (1000 * 60 * 60);
    if (!isNaN(horas)) {
      if (delivery < pickup) {
        hallazgos.push('❌ Fecha de entrega es ANTERIOR al pickup — error en el documento');
        semaforo = 'rojo';
      } else if (horas < 4 && datos.millas && datos.millas > 100) {
        hallazgos.push(`❌ Ventana de solo ${horas.toFixed(0)}h para ${datos.millas} millas — inviable`);
        semaforo = 'rojo';
      }
    }
  }

  // Regla 4: Appointment window
  if (datos.appointment_window) {
    hallazgos.push(`✓ Appointment window: ${datos.appointment_window}`);
  } else {
    hallazgos.push('⚠ Appointment window no especificada — puede haber esperas sin compensación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 5: Ruta
  if (!datos.origen || !datos.destino) {
    hallazgos.push('⚠ Origen o destino incompleto');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ Ruta: ${datos.origen} → ${datos.destino}`);
    if (datos.millas) hallazgos.push(`✓ Distancia: ${datos.millas} millas`);
  }

  // Regla 6: Referencias críticas
  const tieneRef = datos.load_number || datos.reference_number || datos.delivery_order_number;
  if (!tieneRef) {
    hallazgos.push('⚠ Sin número de referencia (Load #, Ref # o DO #) — solicitar antes de operar');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    if (datos.load_number) hallazgos.push(`✓ Load #: ${datos.load_number}`);
    if (datos.reference_number) hallazgos.push(`✓ Ref #: ${datos.reference_number}`);
    if (datos.delivery_order_number) hallazgos.push(`✓ DO #: ${datos.delivery_order_number}`);
  }

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — fechas imposibles o referencias críticas ausentes'
    : semaforo === 'amarillo'
    ? 'Revisar antes de aceptar — confirmar tiempos y referencias con broker'
    : 'Aceptar — fechas y referencias completas y viables';

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
    recomendacion: accion,
  };
}

// ── G. CLÁUSULAS Y PENALIDADES ────────────────────────────────────────────────

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

  // Regla 1: Cláusulas abusivas
  const encontradas = CLAUSULAS_ABUSIVAS.filter(c => textoBase.includes(c));
  if (encontradas.length > 0) {
    hallazgos.push(`❌ Cláusulas de riesgo detectadas: ${encontradas.join(', ')}`);
    semaforo = encontradas.length >= 2 ? 'rojo' : 'amarillo';
  }

  // Regla 2: Detention
  if (!datos.detention_rate) {
    hallazgos.push('⚠ Detention no especificada');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    const matchDet = datos.detention_rate.match(/\$?(\d+)/);
    if (matchDet && parseInt(matchDet[1]) < 50) {
      hallazgos.push(`⚠ Detention baja: ${datos.detention_rate} (estándar: $50-75/hr)`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    } else {
      hallazgos.push(`✓ Detention: ${datos.detention_rate}${datos.detention_free_time ? ' | Free time: ' + datos.detention_free_time : ''}`);
    }
  }

  // Regla 3: Demurrage
  if (datos.demurrage) {
    hallazgos.push(`⚠ Demurrage mencionada: ${datos.demurrage} — verificar quién asume el costo`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 4: Per diem
  if (datos.per_diem) {
    hallazgos.push(`⚠ Per diem mencionado: ${datos.per_diem} — revisar responsabilidad`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 5: TONU
  if (!datos.tonu_rate) {
    hallazgos.push('⚠ TONU no mencionado — sin protección por no-show o cancelación');
    if (semaforo === 'verde') semaforo = 'amarillo';
  } else {
    hallazgos.push(`✓ TONU: ${datos.tonu_rate}`);
  }

  // Regla 6: Fee deductions
  if (datos.fee_deductions) {
    hallazgos.push(`❌ Fee deductions detectadas: ${datos.fee_deductions} — impacto en pago neto`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  // Regla 7: Responsabilidad excesiva del carrier
  if (datos.responsabilidad_carrier) {
    const respLower = datos.responsabilidad_carrier.toLowerCase();
    const excesiva = ['unlimited', 'unconditional', 'all damage', 'full liability', 'any and all'].some(k => respLower.includes(k));
    if (excesiva) {
      hallazgos.push(`❌ Cláusula de responsabilidad excesiva del carrier detectada`);
      semaforo = 'rojo';
    } else {
      hallazgos.push(`⚠ Responsabilidad del carrier: ${datos.responsabilidad_carrier} — revisar alcance`);
      if (semaforo === 'verde') semaforo = 'amarillo';
    }
  }

  // Regla 8: Penalidades generales
  if (datos.penalidades) {
    hallazgos.push(`⚠ Penalidades: ${datos.penalidades}`);
    if (semaforo === 'verde') semaforo = 'amarillo';
  }

  if (hallazgos.length === 0) {
    hallazgos.push('✓ Sin cláusulas de riesgo detectadas');
  }

  const accion = semaforo === 'rojo'
    ? 'No aceptar hasta corregir — cláusulas abusivas o responsabilidad excesiva'
    : semaforo === 'amarillo'
    ? 'Negociar — revisar y aclarar cláusulas antes de firmar'
    : 'Aceptar — cláusulas dentro de parámetros normales';

  return {
    categoria: 'Cláusulas y Penalidades',
    semaforo,
    hallazgos,
    datos_extraidos: {
      detention: datos.detention_rate || 'No especificada',
      tonu: datos.tonu_rate || 'No especificado',
      demurrage: datos.demurrage || 'No mencionado',
      per_diem: datos.per_diem || 'No mencionado',
      penalidades: datos.penalidades || 'Ninguna detectada',
    },
    recomendacion: accion,
  };
}

// ── Veredicto final ──────────────────────────────────────────────────────────

function calcularVeredicto(categorias, userRole) {
  const rojos = categorias.filter(c => c.semaforo === 'rojo').length;
  const amarillos = categorias.filter(c => c.semaforo === 'amarillo').length;
  const perspectiva = userRole === 'carrier' ? 'rentabilidad y viabilidad operativa' : 'completitud y asignación';

  let veredicto, semaforo_general, resumen;

  if (rojos >= 2) {
    veredicto = 'No aceptar hasta corregir';
    semaforo_general = 'rojo';
    resumen = `${rojos} categorías críticas detectadas. Desde la perspectiva de ${perspectiva}, este documento presenta riesgos inaceptables.`;
  } else if (rojos === 1) {
    veredicto = 'No aceptar hasta corregir';
    semaforo_general = 'rojo';
    resumen = `1 alerta crítica en ${categorias.find(c => c.semaforo === 'rojo')?.categoria}. Debe corregirse antes de proceder.`;
  } else if (amarillos >= 3) {
    veredicto = 'Negociar';
    semaforo_general = 'amarillo';
    resumen = `${amarillos} puntos de atención. Varias condiciones requieren negociación antes de aceptar.`;
  } else if (amarillos >= 1) {
    veredicto = 'Revisar antes de aceptar';
    semaforo_general = 'amarillo';
    resumen = `${amarillos} punto(s) a confirmar. Revisar con broker y validar condiciones antes de firmar.`;
  } else {
    veredicto = 'Aceptar';
    semaforo_general = 'verde';
    resumen = `Documento completo y dentro de parámetros operativos. Puede proceder a aceptar.`;
  }

  const alertas_criticas = categorias
    .filter(c => c.semaforo === 'rojo')
    .flatMap(c => c.hallazgos.filter(h => h.startsWith('❌')).slice(0, 2));

  const puntos_negociar = categorias
    .filter(c => c.semaforo !== 'verde')
    .map(c => `${c.categoria}: ${c.recomendacion}`);

  return { veredicto, semaforo_general, resumen_ejecutivo: resumen, alertas_criticas, puntos_negociar };
}

// ── Utilidad: hash simple ─────────────────────────────────────────────────────

async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.slice(0, 1000));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'No autorizado' }, { status: 401 });

    const { documentText, selectedCarrierId } = await req.json();
    if (!documentText || documentText.trim().length < 20) {
      return Response.json({ error: 'Texto del documento vacío o muy corto' }, { status: 400 });
    }

    // Cargar contexto del usuario en paralelo
    const [profiles, costConfigs, trucks, brokers, carrierProfiles, dispatcherProfiles, brokerProfiles] = await Promise.all([
      base44.entities.UserProfile.filter({ usuario: user.email }),
      base44.entities.CostConfig.filter({ usuario: user.email }),
      base44.entities.Truck.list(),
      base44.entities.Broker.list(),
      base44.entities.CarrierProfile.filter({ active: true }),
      base44.entities.DispatcherProfile.filter({ user_id: user.email }),
      base44.entities.BrokerProfile.filter({ active: true }),
    ]);

    const userProfile = profiles[0] || null;
    const costConfig = costConfigs[0] || null;
    const userRole = userProfile?.rol || 'dispatcher';
    const dispatcherProfile = dispatcherProfiles[0] || null;

    // Resolver CarrierProfile:
    // 1. Si el frontend envió un carrierId explícito (dispatcher multi-carrier seleccionó uno)
    // 2. Si el dispatcher tiene un default_carrier configurado
    // 3. Si el usuario es carrier, usar el primer CarrierProfile activo suyo
    // 4. Fallback: primer CarrierProfile activo
    let carrierProfile = null;
    if (selectedCarrierId) {
      carrierProfile = carrierProfiles.find(c => c.id === selectedCarrierId) || null;
    }
    if (!carrierProfile && dispatcherProfile?.default_carrier) {
      carrierProfile = carrierProfiles.find(c => c.id === dispatcherProfile.default_carrier) || null;
    }
    if (!carrierProfile) {
      carrierProfile = carrierProfiles[0] || null;
    }

    // Verificar tipo de documento
    const typeCheck = await base44.integrations.Core.InvokeLLM({
      prompt: `Is this text a trucking Rate Confirmation or Delivery Order? Answer ONLY "yes" or "no".\n\n${documentText.slice(0, 400)}`,
    });
    if (typeof typeCheck === 'string' && typeCheck.toLowerCase().trim().startsWith('no')) {
      return Response.json({
        error: 'Solo proceso Rate Confirmations y Delivery Orders. No se aceptan documentos bancarios ni sensibles.'
      }, { status: 400 });
    }

    // Extracción estructurada
    const datos = await extractDocumentData(base44, documentText);

    // Validaciones por categoría — todas con contexto enriquecido
    const categorias = [
      validarRate(datos, costConfig, userRole),
      validarCommodity(datos, carrierProfile),
      validarEquipo(datos, trucks, carrierProfile),
      validarBroker(datos, brokers, brokerProfiles),
      validarCarrier(datos, carrierProfile),
      validarFechasOperacion(datos),
      validarClausulas(datos),
    ];

    // Veredicto general
    const { veredicto, semaforo_general, resumen_ejecutivo, alertas_criticas, puntos_negociar } = calcularVeredicto(categorias, userRole);

    // Confidence score basado en campos detectados
    const camposDetectados = [
      datos.tarifa_total, datos.terminos_pago, datos.commodity, datos.tipo_equipo,
      datos.broker_nombre, datos.broker_mc, datos.carrier_nombre,
      datos.pickup_fecha, datos.delivery_fecha,
      datos.load_number || datos.reference_number || datos.delivery_order_number,
    ].filter(Boolean).length;
    const confidence_score = Math.round((camposDetectados / 10) * 100);

    // Guardar en DocumentVerification
    const docHash = await hashText(documentText);
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

    // Mensaje de foco según rol
    const foco_analisis = userRole === 'carrier'
      ? 'Enfoque: rentabilidad, cumplimiento operativo y compatibilidad de flota'
      : dispatcherProfile?.dispatch_mode === 'multi_carrier'
      ? `Enfoque: completitud del documento, broker, carrier asignado (${carrierProfile?.company_name || 'no seleccionado'})`
      : `Enfoque: compatibilidad con ${carrierProfile?.company_name || 'carrier'}, completitud y riesgo documental`;

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
        dispatch_mode: dispatcherProfile?.dispatch_mode || null,
        confidence_score,
        carrier_profile_used: carrierProfile?.company_name || null,
        foco_analisis,
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});