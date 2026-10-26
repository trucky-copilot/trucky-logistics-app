/**
 * Motor centralizado de Alertas Operacionales para Trucky.
 * Filtra y recopila exclusivamente alertas de nivel ROJO (críticas) y AMARILLO (advertencias)
 * para los 4 módulos operativos: Flotas, Conductores, Brokers y Cargas (+ notificaciones del sistema).
 * 
 * Regla de negocio estricta: "Las notificaciones deben mostrar de todos los módulos que estén
 * en rojo o amarillo en brokers, en flotas, en conductores, en cargas; las verdes no".
 */

export function getOperationalAlerts({
  trucks = [],
  drivers = [],
  brokers = [],
  loads = [],
  notifications = [],
  locale = 'es'
}) {
  const isEn = locale === 'en';
  const alerts = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ==========================================
  // 1. FLOTAS (TRUCKS)
  // ==========================================
  trucks.forEach(truck => {
    // ROJO: En mantenimiento
    if (truck.estado === 'mantenimiento') {
      alerts.push({
        id: `truck-maint-${truck.id}`,
        modulo: 'flota',
        moduloLabel: isEn ? 'Fleet' : 'Flota',
        nivel: 'rojo',
        titulo: `${isEn ? 'Truck' : 'Camión'} ${truck.placa}`,
        mensaje: isEn
          ? `In maintenance${truck.conductor_nombre ? ` — Driver: ${truck.conductor_nombre}` : ''}`
          : `En mantenimiento${truck.conductor_nombre ? ` — Conductor: ${truck.conductor_nombre}` : ''}`,
        icon: 'Truck',
        link: '/flota',
        urgent: true,
      });
    }

    // AMARILLO: En yarda (esperando asignación o ruta)
    if (truck.estado === 'en_yarda') {
      alerts.push({
        id: `truck-yard-${truck.id}`,
        modulo: 'flota',
        moduloLabel: isEn ? 'Fleet' : 'Flota',
        nivel: 'amarillo',
        titulo: `${isEn ? 'Truck' : 'Camión'} ${truck.placa}`,
        mensaje: isEn
          ? `In yard (unassigned/waiting)${truck.conductor_nombre ? ` — Driver: ${truck.conductor_nombre}` : ''}`
          : `En yarda (sin ruta activa)${truck.conductor_nombre ? ` — Conductor: ${truck.conductor_nombre}` : ''}`,
        icon: 'Truck',
        link: '/flota',
        urgent: false,
      });
    }

    // AMARILLO: Chasis no disponible
    if (truck.chasis_disponible === false && truck.estado !== 'mantenimiento') {
      alerts.push({
        id: `truck-chassis-${truck.id}`,
        modulo: 'flota',
        moduloLabel: isEn ? 'Fleet' : 'Flota',
        nivel: 'amarillo',
        titulo: `${isEn ? 'Truck' : 'Camión'} ${truck.placa}`,
        mensaje: isEn
          ? `Chassis unavailable (${truck.chasis_numero || 'N/A'})`
          : `Chasis no disponible (${truck.chasis_numero || 'N/A'})`,
        icon: 'Truck',
        link: '/flota',
        urgent: false,
      });
    }

    // VERDES: disponible, en_ruta -> Excluidas
  });

  // ==========================================
  // 2. CONDUCTORES (DRIVERS)
  // ==========================================
  drivers.forEach(driver => {
    const driverName = `${driver.nombre || ''} ${driver.apellido || ''}`.trim() || (isEn ? 'Driver' : 'Conductor');

    // ROJO: Conductor en suspensión
    if (driver.estado === 'suspension' || driver.estado === 'suspendido') {
      alerts.push({
        id: `driver-susp-${driver.id}`,
        modulo: 'conductores',
        moduloLabel: isEn ? 'Drivers' : 'Conductores',
        nivel: 'rojo',
        titulo: driverName,
        mensaje: isEn ? 'Driver is suspended' : 'Conductor suspendido',
        icon: 'AlertTriangle',
        link: '/conductores',
        urgent: true,
      });
    }

    // AMARILLO: Conductor de vacaciones
    if (driver.estado === 'vacaciones') {
      alerts.push({
        id: `driver-vac-${driver.id}`,
        modulo: 'conductores',
        moduloLabel: isEn ? 'Drivers' : 'Conductores',
        nivel: 'amarillo',
        titulo: driverName,
        mensaje: isEn ? 'Driver on vacation' : 'Conductor en vacaciones',
        icon: 'AlertTriangle',
        link: '/conductores',
        urgent: false,
      });
    }

    // Documentos (Licencia, Médico, TWIC, HazMat)
    const docFields = [
      { key: 'licencia_vencimiento', label: isEn ? 'License' : 'Licencia' },
      { key: 'medico_vencimiento', label: isEn ? 'Medical' : 'Médico' },
      { key: 'twic_vencimiento', label: 'TWIC' },
      { key: 'hazmat_vencimiento', label: 'HazMat' },
    ];

    docFields.forEach(({ key, label }) => {
      const dateStr = driver[key];
      if (dateStr) {
        const exp = new Date(dateStr);
        exp.setHours(0, 0, 0, 0);
        const diff = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diff < 0) {
          // ROJO: Vencido
          alerts.push({
            id: `driver-doc-exp-${driver.id}-${key}`,
            modulo: 'conductores',
            moduloLabel: isEn ? 'Drivers' : 'Conductores',
            nivel: 'rojo',
            titulo: driverName,
            mensaje: isEn
              ? `${label}: EXPIRED ${Math.abs(diff)}d ago (${dateStr})`
              : `${label}: VENCIDO hace ${Math.abs(diff)}d (${dateStr})`,
            icon: 'FileWarning',
            link: '/conductores',
            urgent: true,
          });
        } else if (diff <= 60) {
          // AMARILLO: Vence en menos de 60 días
          alerts.push({
            id: `driver-doc-soon-${driver.id}-${key}`,
            modulo: 'conductores',
            moduloLabel: isEn ? 'Drivers' : 'Conductores',
            nivel: 'amarillo',
            titulo: driverName,
            mensaje: isEn
              ? `${label}: expires in ${diff}d (${dateStr})`
              : `${label}: vence en ${diff}d (${dateStr})`,
            icon: 'FileWarning',
            link: '/conductores',
            urgent: false,
          });
        }
      }
    });

    // VERDES: estado activo y documentos al día -> Excluidas
  });

  // ==========================================
  // 3. BROKERS
  // ==========================================
  brokers.forEach(broker => {
    const brokerName = broker.nombre || (isEn ? 'Broker' : 'Broker');

    // ROJO: Broker Bloqueado
    if (broker.estado === 'bloqueado') {
      alerts.push({
        id: `broker-block-${broker.id}`,
        modulo: 'brokers',
        moduloLabel: 'Brokers',
        nivel: 'rojo',
        titulo: `Broker ${brokerName}`,
        mensaje: isEn
          ? 'Broker is blocked (operational/payment risk)'
          : 'Broker bloqueado (riesgo operativo o de pago)',
        icon: 'Building2',
        link: '/brokers',
        urgent: true,
      });
    }

    // ROJO: Puntaje de confiabilidad crítico (< 5) cuando no esté ya bloqueado
    if (broker.estado !== 'bloqueado' && broker.puntaje_confiabilidad !== undefined && Number(broker.puntaje_confiabilidad) < 5) {
      alerts.push({
        id: `broker-score-crit-${broker.id}`,
        modulo: 'brokers',
        moduloLabel: 'Brokers',
        nivel: 'rojo',
        titulo: `Broker ${brokerName}`,
        mensaje: isEn
          ? `Critical reliability rating: ${broker.puntaje_confiabilidad}/10`
          : `Calificación crítica de confiabilidad: ${broker.puntaje_confiabilidad}/10`,
        icon: 'Building2',
        link: '/brokers',
        urgent: true,
      });
    }

    // AMARILLO: Estado Precaución
    if (broker.estado === 'precaucion') {
      alerts.push({
        id: `broker-warn-${broker.id}`,
        modulo: 'brokers',
        moduloLabel: 'Brokers',
        nivel: 'amarillo',
        titulo: `Broker ${brokerName}`,
        mensaje: isEn
          ? 'Broker under caution / observation'
          : 'Broker en observación / precaución',
        icon: 'Building2',
        link: '/brokers',
        urgent: false,
      });
    }

    // AMARILLO: Confiabilidad regular (entre 5 y 6.9) en brokers no bloqueados
    if (
      broker.estado !== 'bloqueado' &&
      broker.estado !== 'precaucion' &&
      broker.puntaje_confiabilidad !== undefined &&
      Number(broker.puntaje_confiabilidad) >= 5 &&
      Number(broker.puntaje_confiabilidad) < 7
    ) {
      alerts.push({
        id: `broker-score-mod-${broker.id}`,
        modulo: 'brokers',
        moduloLabel: 'Brokers',
        nivel: 'amarillo',
        titulo: `Broker ${brokerName}`,
        mensaje: isEn
          ? `Moderate reliability rating: ${broker.puntaje_confiabilidad}/10`
          : `Confiabilidad moderada: ${broker.puntaje_confiabilidad}/10`,
        icon: 'Building2',
        link: '/brokers',
        urgent: false,
      });
    }

    // AMARILLO: Términos de pago extendidos (> 45 días)
    if (broker.dias_pago && Number(broker.dias_pago) > 45 && broker.estado !== 'bloqueado') {
      alerts.push({
        id: `broker-paydays-${broker.id}`,
        modulo: 'brokers',
        moduloLabel: 'Brokers',
        nivel: 'amarillo',
        titulo: `Broker ${brokerName}`,
        mensaje: isEn
          ? `Extended payment terms: ${broker.dias_pago} days`
          : `Plazo de pago extendido: ${broker.dias_pago} días`,
        icon: 'Building2',
        link: '/brokers',
        urgent: false,
      });
    }

    // VERDES: activo con puntaje >= 7 y días de pago <= 45 -> Excluidas
  });

  // ==========================================
  // 4. CARGAS (LOADS)
  // ==========================================
  loads.forEach(load => {
    const loadRef = load.numero_referencia
      ? `#${load.numero_referencia}`
      : (load.origen && load.destino ? `${load.origen} → ${load.destino}` : `#${load.id?.slice?.(-4) || 'Carga'}`);
    const loadTitle = `${isEn ? 'Load' : 'Carga'} ${loadRef}`;

    // ROJO: Carga cancelada
    if (load.estado === 'cancelado') {
      alerts.push({
        id: `load-cancel-${load.id}`,
        modulo: 'cargas',
        moduloLabel: isEn ? 'Loads' : 'Cargas',
        nivel: 'rojo',
        titulo: loadTitle,
        mensaje: isEn ? 'Load was cancelled' : 'Carga cancelada',
        icon: 'Package',
        link: '/cargas',
        urgent: true,
      });
    }

    // ROJO: Pérdida financiera proyectada
    if (load.estado !== 'cancelado' && (load.resultado === 'perdida' || (load.ganancia_estimada !== undefined && Number(load.ganancia_estimada) < -50))) {
      alerts.push({
        id: `load-loss-${load.id}`,
        modulo: 'cargas',
        moduloLabel: isEn ? 'Loads' : 'Cargas',
        nivel: 'rojo',
        titulo: loadTitle,
        mensaje: isEn
          ? `Projected financial loss: -$${Math.abs(Math.round(load.ganancia_estimada || 0))}`
          : `Pérdida financiera proyectada: -$${Math.abs(Math.round(load.ganancia_estimada || 0))}`,
        icon: 'Package',
        link: '/cargas',
        urgent: true,
      });
    }

    // ROJO: Entrega retrasada (fecha de entrega pasada y aún no entregada ni cancelada)
    if (load.fecha_entrega && load.estado !== 'entregado' && load.estado !== 'cancelado') {
      const delivDate = new Date(load.fecha_entrega);
      delivDate.setHours(0, 0, 0, 0);
      if (delivDate < today) {
        alerts.push({
          id: `load-delayed-${load.id}`,
          modulo: 'cargas',
          moduloLabel: isEn ? 'Loads' : 'Cargas',
          nivel: 'rojo',
          titulo: loadTitle,
          mensaje: isEn
            ? `Delivery delayed (scheduled: ${load.fecha_entrega})`
            : `Entrega retrasada (programada: ${load.fecha_entrega})`,
          icon: 'Package',
          link: '/cargas',
          urgent: true,
        });
      }
    }

    // AMARILLO: Carga pendiente de asignación / despacho
    if (load.estado === 'pendiente') {
      alerts.push({
        id: `load-pending-${load.id}`,
        modulo: 'cargas',
        moduloLabel: isEn ? 'Loads' : 'Cargas',
        nivel: 'amarillo',
        titulo: loadTitle,
        mensaje: isEn
          ? `Pending dispatch / assignment (${load.origen || ''} → ${load.destino || ''})`
          : `Pendiente de asignación / despacho (${load.origen || ''} → ${load.destino || ''})`,
        icon: 'Package',
        link: '/cargas',
        urgent: false,
      });
    }

    // AMARILLO: Margen en break-even
    if (
      load.estado !== 'cancelado' &&
      load.estado !== 'pendiente' &&
      load.resultado === 'break_even'
    ) {
      alerts.push({
        id: `load-breakeven-${load.id}`,
        modulo: 'cargas',
        moduloLabel: isEn ? 'Loads' : 'Cargas',
        nivel: 'amarillo',
        titulo: loadTitle,
        mensaje: isEn
          ? `Break-even operating margin (~$${Math.round(load.ganancia_estimada || 0)})`
          : `Margen en break-even (~$${Math.round(load.ganancia_estimada || 0)})`,
        icon: 'Package',
        link: '/cargas',
        urgent: false,
      });
    }

    // VERDES: entregado, ganancia, en tránsito a tiempo -> Excluidas
  });

  // ==========================================
  // 5. NOTIFICACIONES DEL SISTEMA (BD)
  // ==========================================
  notifications.forEach(notif => {
    const isError =
      notif.prioridad === 'alta' ||
      notif.prioridad === 'Alta' ||
      notif.tipo === 'documento_vencido' ||
      notif.tipo === 'alerta_tarifa';

    const isWarning =
      notif.prioridad === 'media' ||
      notif.prioridad === 'Media' ||
      notif.tipo === 'retraso_ruta';

    if (isError) {
      alerts.push({
        id: `sys-notif-${notif.id}`,
        modulo: 'sistema',
        moduloLabel: isEn ? 'Notification' : 'Notificación',
        nivel: 'rojo',
        titulo: notif.titulo,
        mensaje: notif.mensaje,
        icon: notif.tipo || 'Bell',
        link: '/notificaciones',
        urgent: true,
        leido: notif.leido,
      });
    } else if (isWarning) {
      alerts.push({
        id: `sys-notif-${notif.id}`,
        modulo: 'sistema',
        moduloLabel: isEn ? 'Notification' : 'Notificación',
        nivel: 'amarillo',
        titulo: notif.titulo,
        mensaje: notif.mensaje,
        icon: notif.tipo || 'Bell',
        link: '/notificaciones',
        urgent: false,
        leido: notif.leido,
      });
    }
    // Prioridad baja o verde -> Excluida
  });

  // ==========================================
  // ORDENAMIENTO: Primero Rojas (críticas), luego Amarillas
  // ==========================================
  return alerts.sort((a, b) => {
    if (a.nivel === 'rojo' && b.nivel !== 'rojo') return -1;
    if (a.nivel !== 'rojo' && b.nivel === 'rojo') return 1;
    return 0;
  });
}
