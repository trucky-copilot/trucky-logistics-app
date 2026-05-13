/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FREIGHT DISPATCHER KNOWLEDGE BASE — Fuente Maestra Consolidada
 * ═══════════════════════════════════════════════════════════════════════════
 * Versión: 1.0.0
 * Fuente: Consolidación de SKILL.md + scenarios.md + regulations.md + load-types.md
 *
 * ARQUITECTURA:
 *   - Este archivo es la ÚNICA fuente de verdad.
 *   - Nunca editar contenido directamente en componentes.
 *   - Cambios aquí se propagan a toda la app automáticamente.
 *   - Consumir siempre a través de freightAdapter.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const FREIGHT_KB_VERSION = '1.0.0';
export const FREIGHT_KB_UPDATED = '2026-05-13';

// ─── SCHEMA DE VALIDACIÓN ────────────────────────────────────────────────────
const REQUIRED_SECTIONS = [
  'meta', 'rpm_benchmarks', 'flat_rate_minimums', 'deadhead_rules',
  'accessorials', 'load_types', 'regulations', 'scenarios',
  'red_flags', 'decision_criteria', 'communication_templates',
  'calculations', 'lane_analysis',
];

// ─── BASE DE CONOCIMIENTO COMPLETA ───────────────────────────────────────────
const RAW_KB = {

  // ── A. METADATOS ────────────────────────────────────────────────────────────
  meta: {
    version:     FREIGHT_KB_VERSION,
    updated:     FREIGHT_KB_UPDATED,
    description: 'Base consolidada de conocimiento operativo para freight dispatching en EE.UU.',
    scope:       'Carriers, owner-operators, small trucking companies',
    market_year: '2024–2025',
  },

  // ── B. CÁLCULOS CORE ────────────────────────────────────────────────────────
  calculations: {
    cpm: {
      label:   'Costo por Milla (CPM)',
      formula: 'Total Weekly Fixed Costs ÷ Miles Driven Per Week',
      components: [
        'Combustible: (millas/semana ÷ MPG) × precio_galon',
        'Pago conductor (si aplica)',
        'Pago/lease del camión',
        'Seguro (prorrateado semanal)',
        'Permisos y licencias (prorrate anual ÷ 52)',
        'Reserva de mantenimiento: $0.15–$0.25/mi',
        'Gastos fijos (ELD, teléfono, factoring, etc.)',
      ],
      note: 'El CPM es el piso absoluto. Operar por debajo = pérdida garantizada.',
    },
    rpm: {
      label:   'Tarifa por Milla (RPM)',
      formula: 'Total Load Pay ÷ Total Miles',
      total_miles_note: 'Siempre incluir millas vacías (deadhead). Nunca solo millas cargadas.',
      round_trip_note:  'Para drayage/local: incluir ida + entrega + regreso vacío.',
      min_profitable:   'RPM mínimo rentable = CPM + margen de ganancia deseado/mi',
    },
    fuel_cost: {
      label:   'Costo de Combustible por Carga',
      formula: '(Total Miles ÷ MPG) × Precio del Galón',
      note:    'Siempre incluir en el análisis de rentabilidad de cualquier carga.',
    },
    net_revenue: {
      label:   'Ingreso Neto por Carga',
      formula: 'Tarifa bruta − Combustible − Pago conductor − Factoring fee − Peajes',
      target:  '$40–$60/hora neto para owner-operators',
    },
    counter_offer: {
      label:   'Cálculo de Contraoferta',
      formula: 'MAX(tu_mínimo, oferta_broker + buffer_negociación)',
      buffer:  '10–15% sobre la oferta del broker',
    },
  },

  // ── C. BENCHMARKS RPM POR EQUIPO ────────────────────────────────────────────
  rpm_benchmarks: [
    { equipment: '53\' Dry Van',           min: 2.00, good: 2.50, excellent: 3.00 },
    { equipment: 'Reefer',                 min: 2.30, good: 2.80, excellent: 3.50 },
    { equipment: 'Flatbed',                min: 2.50, good: 3.00, excellent: 3.75 },
    { equipment: 'Step Deck',              min: 2.75, good: 3.25, excellent: 4.00 },
    { equipment: 'Drayage/Container 20\'', min: 2.75, good: 3.50, excellent: 5.00 },
    { equipment: 'Drayage/Container 40\'', min: 2.50, good: 3.25, excellent: 4.50 },
    { equipment: 'Power Only',             min: 1.50, good: 1.75, excellent: 2.00 },
  ],

  // ── D. MÍNIMOS FLAT RATE ─────────────────────────────────────────────────────
  flat_rate_minimums: [
    { range: 'Menos de 50 mi',  min: 400,  max: 500,  note: 'Short haul — costos fijos dominan' },
    { range: '50–100 mi',       min: 500,  max: 650,  note: '' },
    { range: '100–200 mi',      min: 650,  max: 900,  note: '' },
    { range: '200–400 mi',      min: 900,  max: 1400, note: 'Fórmula RPM generalmente aplica aquí' },
    { range: '400–600 mi',      min: 1400, max: 1800, note: '' },
    { range: '600–800 mi',      min: 1800, max: 2400, note: '' },
    { range: '800+ mi',         min: 2400, max: null,  note: 'Long haul — siempre usar RPM' },
  ],
  flat_rate_rule: 'Usar el MAYOR entre: resultado fórmula RPM O mínimo flat. Ese es el piso.',

  // ── E. REGLAS DE DEADHEAD ───────────────────────────────────────────────────
  deadhead_rules: {
    acceptable:   { threshold_pct: 20,  label: 'Aceptable',     color: 'green'  },
    concerning:   { threshold_pct: 40,  label: 'Preocupante',   color: 'yellow' },
    deal_breaker: { threshold_pct: 999, label: 'Deal-breaker',  color: 'red'    },
    formula:      'True RPM = Pago bruto ÷ (Millas cargadas + Millas vacías)',
    compensation: 'Si deadhead > 100 mi, es aceptable pedir $1.00–$1.50/mi o lump sum.',
  },

  // ── F. ACCESSORIALS ─────────────────────────────────────────────────────────
  accessorials: [
    { service: 'Detention (después de 2 hrs libres)', min: 50,  max: 100,  unit: '/hr',   note: 'Estándar industria: $75/hr' },
    { service: 'Layover',                             min: 150, max: 300,  unit: '/noche', note: 'Pernocta lejos de base' },
    { service: 'TONU (camión enviado, carga cancelada)', min: 150, max: 300, unit: '',    note: 'Cancelada tras llegada del camión' },
    { service: 'Deadhead/dry run',                    min: 1.00, max: 1.50, unit: '/mi',  note: 'Si se envía sin carga' },
    { service: 'Permiso oversize/OW',                 min: 75,  max: 200,  unit: '',      note: 'Varía por estado y dimensiones' },
    { service: 'Team driver',                         min: 0.50, max: 1.00, unit: '/mi',  note: 'Servicio premium de equipo' },
    { service: 'Tarping (flatbed)',                   min: 50,  max: 150,  unit: '/carga', note: '' },
    { service: 'Lumper reimbursement',                min: null, max: null, unit: '',     note: 'Pass-through — guardar recibo' },
    { service: 'Chassis split (drayage)',             min: 75,  max: 75,   unit: '/día',  note: 'Chasis no disponible en terminal' },
    { service: 'Pre-Pull (drayage)',                  min: 100, max: 200,  unit: '',      note: 'Recogida día anterior a entrega' },
    { service: 'Storage (drayage)',                   min: 75,  max: 150,  unit: '/día',  note: 'Contenedor retenido en yard' },
  ],
  accessorials_rule: 'Nunca incluir accessorials en la tarifa all-in a menos que esté explícitamente negociado.',

  // ── G. TIPOS DE CARGA ────────────────────────────────────────────────────────
  load_types: [
    {
      id:          'dry_van',
      label:       'Dry Van (53\' / 48\')',
      description: 'Tipo más común. Tráiler cerrado — protege del clima. Dock-to-dock o floor-loaded.',
      watch_for:   ['Carga pesada mal clasificada como estándar', 'Ventanas de entrega muy ajustadas'],
      always_ask:  [],
      extra_costs: [],
      rpm_min:     2.00,
      rpm_max:     2.50,
    },
    {
      id:          'reefer',
      label:       'Reefer (Temperatura Controlada)',
      description: 'Tráiler refrigerado o con calefacción. Requiere monitoreo continuo de temperatura.',
      watch_for:   ['Verificar configuración de temperatura', 'Producto sensible a variaciones'],
      always_ask:  ['Temperatura requerida', '¿Continua o cíclica?', 'Tipo de producto'],
      extra_costs: ['Diesel para unidad reefer: ~$0.10–0.15/mi', 'Tiempo de pre-enfriamiento'],
      rpm_min:     2.30,
      rpm_max:     2.80,
    },
    {
      id:          'flatbed',
      label:       'Flatbed',
      description: 'Tráiler abierto — carga expuesta. Generalmente mejor pagado pero más trabajo.',
      watch_for:   ['Cargas OD (oversize/overweight) que requieren permisos'],
      always_ask:  ['Dimensiones exactas', '¿Requiere tarping?', 'Requisitos de amarre'],
      extra_costs: ['Cintas, lonas, cadenas según carga'],
      rpm_min:     2.50,
      rpm_max:     3.00,
    },
    {
      id:          'step_deck',
      label:       'Step Deck',
      description: 'Plataforma baja para carga alta. Bueno para equipos y maquinaria.',
      watch_for:   ['Altura legal: 13\'6" de espacio en la mayoría de vías'],
      always_ask:  ['Altura total de la carga'],
      extra_costs: [],
      rpm_min:     2.75,
      rpm_max:     3.25,
    },
    {
      id:          'drayage',
      label:       'Drayage / Contenedor (Intermodal)',
      description: 'Movimiento de contenedores desde/hacia puerto. Calcular millas ida+vuelta.',
      watch_for:   ['Citas en terminal (eModal)', 'Per diem por demoras en puerto'],
      always_ask:  ['Tipo de contenedor (20\' / 40\')', '¿Pre-pull?', '¿Chassis disponible?'],
      extra_costs: ['Pre-pull fee', 'Chassis split', 'Storage per diem'],
      rpm_min:     2.75,
      rpm_max:     3.50,
      special: {
        container_weights: {
          '20ft_tare': 4900,
          '40ft_tare': 8900,
          chassis:    6000,
          tractor:    18000,
          legal_max:  80000,
        },
        pre_pull_formula: 'Mínimo = (millas_ciclo_total × rpm_mínimo) + pre_pull_fee ($100–$200)',
      },
    },
    {
      id:          'ltl',
      label:       'LTL (Less Than Truckload)',
      description: 'Cargas parciales compartiendo espacio con otro flete. Menor compromiso.',
      watch_for:   ['Complejidad en tracking de múltiples pickups/deliveries'],
      always_ask:  [],
      extra_costs: [],
      rpm_min:     null,
      rpm_max:     null,
    },
    {
      id:          'power_only',
      label:       'Power Only',
      description: 'Solo se provee tractor. El shipper provee el tráiler.',
      watch_for:   ['Menor ingreso pero cargas más simples'],
      always_ask:  [],
      extra_costs: [],
      rpm_min:     1.50,
      rpm_max:     2.00,
    },
  ],

  // ── H. REGULACIONES ─────────────────────────────────────────────────────────
  regulations: {
    hos: {
      label: 'Hours of Service (HOS) — Property Carriers',
      rules: [
        { rule: 'Conducción diaria',       limit: '11 horas tras 10h de descanso' },
        { rule: 'On-duty diario',          limit: '14 horas totales (conducción + otras labores)' },
        { rule: 'Semanal (8 días)',         limit: '70 horas on-duty en 8 días' },
        { rule: 'Semanal (7 días)',         limit: '60 horas on-duty en 7 días' },
        { rule: 'Pausa de 30 min',         limit: 'Obligatoria tras 8 horas de conducción' },
        { rule: 'Restart',                 limit: '34 horas off-duty reinicia el reloj semanal' },
        { rule: 'Sleeper berth split',     limit: 'Divisiones 8+2 o 7+3 permitidas' },
      ],
      short_haul_exemption: 'Conductores dentro de 150 millas aéreas de base, sin litera, de regreso en ventana de 14h.',
    },
    weight_limits: {
      label: 'Límites Federales de Peso',
      rules: [
        { config: 'Eje simple',              max_lbs: 20000 },
        { config: 'Eje tándem',             max_lbs: 34000 },
        { config: 'Peso bruto vehicular',   max_lbs: 80000 },
      ],
      note: 'Los estados pueden tener límites menores en ciertas vías. Siempre verificar DOT estatal para rutas específicas, especialmente cargas OW.',
    },
    dimensions: {
      label: 'Dimensiones Legales Federales',
      rules: [
        { dimension: 'Ancho',             limit: '8\'6" (102 pulgadas)' },
        { dimension: 'Altura',            limit: '13\'6" (varía por estado)' },
        { dimension: 'Largo (tráiler)',   limit: '48\' en interestatales (53\' permitido en la mayoría)' },
      ],
      note: 'Exceder estas dimensiones requiere permiso oversize y posible escolta.',
    },
    hazmat: {
      label: 'HAZMAT — Básicos',
      endorsement_required: true,
      classes: [
        { class: 1, label: 'Explosivos' },
        { class: 2, label: 'Gases' },
        { class: 3, label: 'Líquidos inflamables' },
        { class: 4, label: 'Sólidos inflamables' },
        { class: 5, label: 'Oxidantes' },
        { class: 6, label: 'Venenos/tóxicos' },
        { class: 7, label: 'Radioactivos' },
        { class: 8, label: 'Corrosivos' },
        { class: 9, label: 'Misceláneos' },
      ],
      rule: 'NUNCA aceptar HAZMAT sin endorsement CDL y cobertura de seguro apropiada.',
    },
    interstate_vs_intrastate: {
      interstate:  'Cruzar líneas estatales O carga que origina en otro estado → Regulaciones federales FMCSA.',
      intrastate:  'Pickup y delivery dentro del mismo estado → Regulaciones DOT estatal (generalmente menos estrictas).',
      note:        'Siempre clarificar el tipo de autoridad del carrier.',
    },
    ow_permits: {
      label: 'Costos Estimados de Permisos OW (overweight)',
      by_state: [
        { state: 'Florida',          min: 75,  max: 125 },
        { state: 'Georgia',          min: 75,  max: 150 },
        { state: 'Texas',            min: 100, max: 200 },
        { state: 'California',       min: 150, max: 300 },
        { state: 'Corredor multi-estado', min: 400, max: 800 },
      ],
    },
  },

  // ── I. FLAGS DE RIESGO ──────────────────────────────────────────────────────
  red_flags: {
    auto_decline: [
      'Tarifa por debajo del CPM (pérdida garantizada)',
      'HAZMAT sin endorsement apropiado',
      'Equipo no disponible',
      'Entrega requiere permisos no disponibles (bases militares, instalaciones federales)',
      'Carga oversize sin tiempo de gestionar permisos',
      'Doble-brokering sospechoso (broker no puede confirmar shipper)',
      'Pickup mismo día sin cita en terminal',
    ],
    proceed_with_caution: [
      'Broker no verificado (verificar FMCSA / DAT / Carrier411)',
      'Broker nuevo sin historial de pagos',
      'Carga requiere team driver pero el carrier opera solo',
      'Ventana de entrega muy ajustada dado el HOS',
      'Peso cerca del límite legal (dentro de 2,000 lbs)',
      'Tácticas de presión "hot load" del broker',
    ],
  },

  // ── J. CRITERIOS DE DECISIÓN ─────────────────────────────────────────────────
  decision_criteria: {
    take_it:   { label: 'TOMAR',    color: 'green',  emoji: '✅', condition: 'RPM muy por encima del CPM, buena ruta, sin red flags' },
    negotiate: { label: 'NEGOCIAR', color: 'yellow', emoji: '⚠️', condition: 'Tarifa cerca del mínimo, preocupaciones específicas' },
    decline:   { label: 'RECHAZAR', color: 'red',    emoji: '🚫', condition: 'Tarifa bajo CPM, exceso de deadhead, problemas operativos' },
    counter_offer_rules: [
      { gap_pct_max: 15,  action: 'Contrarrestar en tu mínimo, explicar brevemente.' },
      { gap_pct_max: 30,  action: 'Contrarrestar en punto medio, señalar la preocupación.' },
      { gap_pct_max: 999, action: 'Declinar o contrarrestar alto sabiendo que habrá negociación.' },
    ],
  },

  // ── K. ANÁLISIS DE LANE ──────────────────────────────────────────────────────
  lane_analysis: {
    questions: [
      '¿Disponibilidad de carga de regreso desde ciudad de entrega?',
      '¿Tarifa negociable a largo plazo?',
      '¿Tiempo promedio de espera en shipper/receiver?',
      '¿Sistema de citas confiable o constantemente retrasado?',
      '¿Velocidad de pago de este broker?',
      '¿Lane consistente todo el año o estacional?',
    ],
    formula: {
      weekly_revenue: 'Tarifa × cargas por semana',
      weekly_costs:   'Combustible + Conductor + Costos fijos prorrateados',
      weekly_net:     'Ingresos semanales − Costos semanales',
      annual_net:     'Ingreso neto semanal × 52',
    },
    target_net_per_hour: { min: 40, max: 60, currency: 'USD', unit: '/hora neto para owner-operators' },
  },

  // ── L. ESCENARIOS OPERATIVOS ─────────────────────────────────────────────────
  scenarios: [
    {
      id:          'rfq_response',
      label:       'Respuesta a RFQ',
      situation:   'Broker pregunta por tu tarifa en una ruta.',
      steps: [
        'Extraer: pickup, entrega, equipo, peso, fechas',
        'Calcular millas de ida (Google Maps o DAT)',
        'Agregar millas de deadhead desde posición actual',
        'Calcular millas totales (cargadas + deadhead)',
        'Aplicar: MAX(fórmula RPM, mínimo flat para esa distancia)',
        'Agregar 10–15% de buffer de negociación a tu mínimo',
        'Redactar respuesta por email dentro de 5–10 minutos',
      ],
      template: `Hello [Name],\n\nThank you for reaching out. Please see our rate below:\n\nPickup: [City, State] — [Date]\nDelivery: [City, State] — [Date]\nEquipment: [Size/Type]\nRate: $X,XXX.00 All-In\n\nMC#: [Your MC]\nAvailability: [Date/Time]\n\nLet us know how you'd like to proceed.\n\nBest regards,\n[Name] | [Company]\n[Phone] | [Email]`,
    },
    {
      id:          'counter_offer',
      label:       'Contraoferta al Broker',
      situation:   'Oferta del broker está por debajo de tu mínimo.',
      steps: [
        'Calcular: RPM de ellos = su tarifa ÷ millas totales',
        'Tu CPM = tus costos semanales ÷ millas semanales',
        'Gap = Tu RPM mínimo − Su RPM',
        'Si gap < 15%: contrarrestar en tu mínimo',
        'Si gap 15–30%: contrarrestar en punto medio',
        'Si gap > 30%: declinar o contrarrestar alto',
      ],
      template: `Hello [Name],\n\nThank you for the offer. Given the distance and current fuel costs, our best rate for this lane is $X,XXX.00 all-in.\n\nWe're available [date/time] and ready to move as soon as we receive the RC.\n\nLet us know if you can work with that.\n\nBest regards, [Name]`,
    },
    {
      id:          'detention_claim',
      label:       'Reclamo de Detention',
      situation:   'Conductor esperó más de 2 horas en shipper o receiver.',
      steps: [
        'Documentar hora de llegada (BOL timestamp o driver log)',
        'Documentar hora en que se cargó/descargó la mercancía',
        'Calcular horas sobre la ventana libre de 2 horas',
        'Calcular detention: (Horas − 2) × tu tarifa de detention',
        'Anotar en BOL si es posible antes de salir',
        'Enviar email al broker con documentación',
      ],
      template: `Hello [Name],\n\nI'm following up regarding detention for Load #[X].\n\nOur driver arrived at [time] and departed at [time], resulting in [X] hours of wait time. Per our standard terms, detention applies after 2 free hours at $[rate]/hr.\n\nTotal detention: [X hours] × $[rate] = $[total]\n\nPlease confirm so we can include this in our invoice.\n\nBest regards, [Name]`,
    },
    {
      id:          'recurring_lane',
      label:       'Evaluación de Lane Recurrente',
      situation:   'Broker ofrece ruta repetitiva.',
      steps: [
        '¿Cuál es la tarifa y es negociable a largo plazo?',
        '¿Cómo es la situación de backhaul?',
        '¿Cuál es el tiempo promedio de espera en shipper/receiver?',
        '¿Sistema de citas confiable?',
        '¿Velocidad de pago del broker?',
        '¿Lane consistente todo el año o estacional?',
      ],
      formula: 'Ingreso neto anual = (Tarifa × cargas/semana − Costos semanales) × 52',
      template: null,
    },
    {
      id:          'cpm_calculation',
      label:       'Cálculo Real de CPM',
      situation:   'Calcular costo por milla exacto del carrier.',
      steps: [
        'Listar TODOS los costos semanales',
        'Total costos semanales ÷ millas semanales = CPM',
        'RPM mínimo rentable = CPM + $0.10–$0.25 margen',
      ],
      example: {
        weekly_miles:    2500,
        fuel:            1462,
        driver:          1200,
        truck_payment:    800,
        insurance:        450,
        maintenance:      375,
        fixed_other:      200,
        total:           4487,
        cpm:             1.79,
        min_rpm:         2.04,
      },
      template: null,
    },
    {
      id:          'overweight_load',
      label:       'Análisis de Carga Overweight',
      situation:   'Carga supera o puede superar límites legales de peso.',
      steps: [
        'Obtener peso exacto de la carga del broker',
        'Calcular peso bruto total (carga + tara + chasis + tractor)',
        'Verificar límites legales estatales en la ruta',
        'Si es overweight: investigar costo y tiempo de gestión de permisos por estado',
        'Verificar si hay rutas/puentes restringidos',
        'Agregar costo de permisos + escolta si aplica + buffer por demoras',
      ],
      template: null,
    },
    {
      id:          'decline_with_pitch',
      label:       'Declinar con Pitch Futuro',
      situation:   'Carga no es viable pero quieres mantener la relación con el broker.',
      steps: [
        'Razón breve y clara para declinar',
        'Mencionar qué SÍ puedes hacer',
        'Invitar a cargas futuras',
      ],
      template: `Hello [Name],\n\nThank you for thinking of us. Unfortunately we're unable to cover this particular load as [brief reason — equipment/lane/availability].\n\nWe do handle [what you do] and would love to be considered for future loads in [your coverage area].\n\nLooking forward to working together.\n\nBest regards, [Name]`,
    },
    {
      id:          'drayage_prepull',
      label:       'Cálculo de Pre-Pull Drayage',
      situation:   'Carga de contenedor requiere pre-pull (recogida el día anterior a la entrega).',
      steps: [
        'Día 1 (Pre-Pull): Yard → Puerto = X mi. Puerto → Yard = X mi. Subtotal = 2X mi.',
        'Día 2 (Entrega): Yard → Entrega = Y mi. Entrega → Puerto vacío = Z mi. Puerto → Yard = X mi. Subtotal = Y + Z + X mi.',
        'Total por contenedor = Día 1 + Día 2',
        'Usar millas totales del ciclo para el RPM — NUNCA solo el tramo de entrega.',
        'Mínimo = (millas_ciclo_total × RPM_mínimo) + pre_pull_fee',
      ],
      template: null,
    },
  ],

  // ── M. TEMPLATES DE COMUNICACIÓN ────────────────────────────────────────────
  communication_templates: {
    rfq_response: {
      label:    'Respuesta a RFQ',
      tone:     'Profesional, directo. Lead con tarifa y disponibilidad. Menos de 150 palabras.',
      include:  ['equipo', 'MC#', 'disponibilidad', 'tarifa'],
    },
    load_acceptance: {
      label:    'Aceptación de Carga',
      tone:     'Confirmar todos los detalles. Pedir RC inmediatamente.',
      include:  ['load #', 'pickup info', 'delivery info', 'tarifa', 'equipo'],
    },
    decline: {
      label:    'Declinar Carga',
      tone:     'Breve, sin sobre-explicar. Mencionar qué SÍ puedes hacer. Dejar puerta abierta.',
      include:  ['razón breve', 'alternativa', 'invitación a cargas futuras'],
    },
    counter_offer: {
      label:    'Contraoferta',
      tone:     'Profesional y directo. No disculparse por la tarifa. Crear urgencia leve.',
      include:  ['reconocer su oferta', 'tu counter claro', '1 razón breve (opcional)', 'urgencia'],
    },
  },

  // ── N. CARRIER PROFILE SETUP ─────────────────────────────────────────────────
  carrier_profile_fields: [
    { field: 'company_name_mc',   label: 'Nombre de empresa y MC# (si aplica)' },
    { field: 'equipment_types',   label: 'Tipos de equipo: dry van, reefer, flatbed, step deck, etc.' },
    { field: 'equipment_sizes',   label: 'Tamaños de equipo: 20\', 40\', 48\', 53\', etc.' },
    { field: 'coverage_regions',  label: 'Estados/regiones cubiertos (o "todos los 48")' },
    { field: 'home_base',         label: 'Ciudad/estado base (para cálculo de millas vacías)' },
    { field: 'weekly_fixed_costs',label: 'Costos fijos semanales (combustible, conductor, seguro, etc.)' },
    { field: 'avg_mpg',           label: 'MPG promedio del camión' },
    { field: 'fuel_price',        label: 'Precio actual del combustible en su área' },
    { field: 'factoring',         label: '¿Usan factoring? Si sí, ¿qué porcentaje?' },
    { field: 'min_rpm',           label: 'RPM mínimo aceptable (si lo conocen)' },
  ],
};

// ─── VALIDACIÓN DE INTEGRIDAD ─────────────────────────────────────────────────
function validateKnowledgeBase(kb) {
  const missing = REQUIRED_SECTIONS.filter(section => !kb[section]);
  if (missing.length > 0) {
    console.warn('[FreightKB] Secciones faltantes:', missing);
  }
  return missing.length === 0;
}

const _isValid = validateKnowledgeBase(RAW_KB);

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { RAW_KB as FREIGHT_KB };
export const KB_VALID = _isValid;