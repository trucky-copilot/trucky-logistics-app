import { createContext, useContext, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAppState } from '@/lib/AppStateContext';

const LanguageContext = createContext(null);

const translations = {
  es: {
    nav: {
      dashboard: 'Dashboard',
      chat: 'Chat de Mercado',
      emails: 'Emails',
      documents: 'Verificador',
      loads: 'Cargas',
      fleet: 'Flota',
      drivers: 'Conductores',
      brokers: 'Brokers',
      calculator: 'Calculadora',
      notifications: 'Notificaciones',
      profile: 'Perfil',
      activeSession: 'Sesión activa',
      account: 'Cuenta',
      noEmail: 'Sin correo asociado',
      logout: 'Cerrar sesión',
      openProfile: 'Abrir menú de perfil',
    },
    dashboard: {
      title: 'Dashboard Operacional', organization: 'Mi organización', weeklyRevenue: 'Facturación Semana',
      netProfit: 'Ganancia Neta', averageRate: 'Tarifa Promedio/Milla', weeklyTrips: 'Viajes Esta Semana',
      loads: 'cargas', estimatedThisWeek: 'estimado esta semana', target: 'meta: $3.00/milla',
      inTransitNow: 'en tránsito ahora', fleetStatus: 'Estado de la Flota', viewAll: 'Ver todo',
      noTrucks: 'No hay camiones registrados', noDriver: 'Sin conductor', documentAlerts: 'Alertas de Documentos',
      next30Days: 'próx. 30 días', allDocumentsOk: 'Todos los documentos en orden', expired: 'VENCIDO',
      expires: 'Vence', topBrokers: 'Top Brokers', noBrokers: 'No hay brokers registrados', recentLoads: 'Cargas Recientes',
      viewAllLoads: 'Ver todas', noLoads: 'No hay cargas registradas aún', route: 'Ruta', miles: 'Millas',
      result: 'Resultado', broker: 'Broker', total: 'Total', error: 'No se pudieron cargar los datos del dashboard. Intenta recargar la página.',
      alertsAndNotifications: 'Alertas y Notificaciones', allInOrder: 'Todo está en orden',
    },
    calculator: {
      title: 'Calculadora de Costo/Milla', subtitle: 'Calcula tu break-even y tarifa mínima rentable',
      variables: 'Variables del negocio', diesel: 'Precio diésel ($/gal)', mpg: 'MPG del camión', insurance: 'Seguro ($/semana)',
      lease: 'Lease/renta ($/semana)', driverPay: '% pago conductor', otherCosts: 'Otros gastos ($/semana)',
      weeklyMiles: 'Millas/semana promedio', targetRate: 'Tarifa objetivo ($/mi)', results: 'Resultados', costPerMile: 'Costo por milla',
      dieselFixed: 'diesel + fijos', breakEven: 'Break-even', minimumRate: 'tarifa mínima', target: 'Tarifa objetivo',
      profit: 'ganancia', profitable: 'Rentable', loss: 'Pérdida', earns: 'Ganas', loses: 'Pierdes', rejectOrNegotiate: 'rechaza o negocia',
      missing: 'Falta', cannotCalculate: 'un dato: no puedo calcular tu costo por milla.', saved: 'Guardado', save: 'Guardar configuración',
      breakEvenLabel: 'Piso (Break-Even)', targetLabel: 'Objetivo', marketLabel: 'Mercado\nFlorida',
      accessorialsTitle: 'Cargos Adicionales / Accesoriales',
      enableCustom: 'Activar personalizados',
      customAccessorialsDesc: 'Ingresa tus montos para cada cargo. El chat priorizará estos valores sobre los de mercado.',
      otherAccessorials: 'Otros cargos adicionales...',
    },
    common: {
      deleteConfirmTitle: 'Confirmar eliminación',
      deleteTruckPrompt: (name) => `¿Desea eliminar el Camión ${name}?`,
      deleteDriverPrompt: (name) => `¿Desea eliminar el Conductor ${name}?`,
      deleteBrokerPrompt: (name) => `¿Desea eliminar el Broker ${name}?`,
      deleteLoadPrompt: '¿Desea eliminar la Carga?',
      cancel: 'Cancelar',
      confirmDelete: 'Eliminar',
    },
    fleet: { title: 'Flota', trucks: 'camiones', add: 'Agregar camión', available: 'Disponibles', enRoute: 'En Ruta', yard: 'En Yarda', maintenance: 'Mant.', edit: 'Editar Camión', new: 'Nuevo Camión', plate: 'Placa', model: 'Modelo', year: 'Año', status: 'Estado', equipmentType: 'Tipo de equipo', assignedDriver: 'Conductor asignado', chassis: 'Chasis #', chassisAvailable: 'Chasis disponible', notes: 'Notas', cancel: 'Cancelar', save: 'Guardar', noTrucks: 'No hay camiones registrados', noAssigned: 'No asignado', availableText: 'Disponible', unavailable: 'No disponible' },
    drivers: { title: 'Conductores', registered: 'registrados', add: 'Agregar conductor', edit: 'Editar Conductor', new: 'Nuevo Conductor', name: 'Nombre', lastName: 'Apellido', phone: 'Teléfono', status: 'Estado', license: 'Licencia CDL #', licenseExpiry: 'Vencimiento licencia', medicalExpiry: 'Médico vence', twicExpiry: 'TWIC vence', hazmatExpiry: 'HazMat vence', assignedTruck: 'Camión asignado (placa)', notes: 'Notas', cancel: 'Cancelar', save: 'Guardar', noDrivers: 'No hay conductores registrados', noPhone: 'Sin teléfono', documentsOk: 'Documentos al día', expired: 'VENCIDO', expiresIn: 'vence en' },
    brokers: { title: 'Brokers', registered: 'registrados', add: 'Agregar broker', edit: 'Editar Broker', new: 'Nuevo Broker', name: 'Nombre', contact: 'Contacto', phone: 'Teléfono', avgRate: 'Tarifa prom $/mi', paymentDays: 'Días de pago', status: 'Estado', reliability: 'Confiabilidad (1-10)', timelyPayment: 'Pago puntual (1-10)', clauses: 'Cláusulas frecuentes / alertas', notes: 'Notas', cancel: 'Cancelar', save: 'Guardar', noBrokers: 'No hay brokers registrados', noMc: 'Sin MC', noContact: 'Sin contacto', loads: 'Cargas', avgRateShort: '$/mi prom', payDays: 'Días pago' },
    loadsPage: { title: 'Cargas', registered: 'registradas', add: 'Nueva carga', revenue: 'Total facturado', profit: 'Ganancia estimada', shown: 'Cargas mostradas', avgRate: '$/mi promedio', all: 'Todas', inTransit: 'En tránsito', pending: 'Pendientes', delivered: 'Entregadas', quickload: '$2.20/mi', gain: 'Ganancia', loss: 'Pérdida', noMatches: 'No hay cargas con este filtro', route: 'Ruta', broker: 'Broker', type: 'Tipo', miles: 'Millas', total: 'Total', result: 'Resultado', status: 'Estado' },
    loadForm: {
      newTitle: 'Nueva Carga',
      editTitle: 'Editar Carga',
      rpmPreview: '$/milla',
      dieselCost: 'Costo diesel',
      origin: 'Origen',
      destination: 'Destino',
      miles: 'Millas',
      offeredRate: 'Tarifa ofrecida $',
      negotiatedRate: 'Tarifa negociada $',
      dieselToday: 'Precio diesel hoy $',
      broker: 'Broker',
      brokerPlaceholder: 'Nombre del broker',
      type: 'Tipo',
      directBroker: 'Broker Directo',
      directClient: 'Cliente Directo',
      pickupDate: 'Fecha carga',
      deliveryDate: 'Fecha entrega',
      status: 'Estado',
      truckPlate: 'Placa camión',
      driver: 'Conductor',
      driverPlaceholder: 'Nombre del conductor',
      notes: 'Notas',
      cancel: 'Cancelar',
      save: 'Guardar carga',
      required: '* Campo obligatorio',
      pending: 'Pendiente',
      inTransit: 'En Tránsito',
      delivered: 'Entregado',
      cancelled: 'Cancelado',
    },
    statuses: {
      disponible: 'Disponible',
      en_ruta: 'En Ruta',
      en_yarda: 'En Yarda',
      mantenimiento: 'Mantenimiento',
      activo: 'Activo',
      inactivo: 'Inactivo',
      vacaciones: 'Vacaciones',
      suspension: 'Suspendido',
      precaucion: 'Precaución',
      bloqueado: 'Bloqueado',
      pendiente: 'Pendiente',
      en_transito: 'En Tránsito',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
      broker_directo: 'Broker Directo',
      cliente_directo: 'Cliente Directo',
    },
    documents: { title: 'Verificador de Documentos', subtitle: 'Rate Confirmations · Delivery Orders — análisis operativo, comercial e identidad', carrierMode: 'Modo Carrier — rentabilidad y operación', dispatcherMode: 'Modo Dispatcher — completitud y asignación', pasteOrUpload: 'Pegar texto o subir documento', upload: 'Subir PDF / JPG / PNG / TXT', accepted: 'Acepta PDF, JPG, PNG, TXT — Solo Rate Confirmations y Delivery Orders', placeholder: 'Pega el texto del Rate Confirmation o Delivery Order aquí...', verify: 'Verificar Documento', extract: 'Extrayendo datos del documento...', validate: 'Validando reglas de negocio...', verifyBroker: 'Verificando broker y carrier...', process: 'Procesando archivo...', processError: 'No se pudo procesar el archivo. Intenta pegar el texto directo.', unsupported: 'Formato no soportado. Usa PDF, JPG, PNG o TXT.', sensitive: 'Por seguridad, no se procesan datos bancarios ni documentos sensibles.', newAnalysis: 'Análisis nuevo', fromCache: 'Desde caché', confidence: 'Confianza', risk: 'Riesgo', registerLoad: 'Registrar carga', mainAlerts: 'ALERTAS PRINCIPALES', analysisByCategory: 'ANÁLISIS POR CATEGORÍA', stepsToFollow: 'PASOS A SEGUIR', critical: 'Crítico', review: 'Revisar', ok: 'OK' },
    map: { title: 'Mapa de Rutas', geolocated: 'cargas geolocalizadas · origen → destino', empty: 'Sin cargas con ubicaciones reconocidas aún', origin: 'Origen', destination: 'Destino', rate: 'Tarifa' },
    notifications: { title: 'Notificaciones', markAll: 'Marcar todas', new: 'Nueva', all: 'Todas', unread: 'Sin leer', high: 'Alta', medium: 'Media', noNotifications: 'No hay notificaciones', formTitle: 'Nueva Notificación', titleLabel: 'Título', message: 'Mensaje', type: 'Tipo', priority: 'Prioridad', send: 'Enviar', cancel: 'Cancelar', justNow: 'hace un momento', hoursAgo: 'hace', assignment: 'Cambio de asignación', delay: 'Retraso en ruta', dispatch: 'Mensaje de despacho', documentoExpired: 'Documento vencido', rateAlert: 'Alerta de tarifa', general: 'General' },
    profiles: {
      loading: 'Cargando Perfil...',
      yourProfiles: 'Tus Perfiles',
      addNewProfile: 'Agregar nuevo perfil',
      rename: 'Renombrar',
      delete: 'Eliminar',
      createTitle: 'Crear Nuevo Perfil',
      renameTitle: 'Renombrar Perfil',
      createDesc: 'Ingresa un nombre para tu nuevo perfil de configuración.',
      renameDesc: 'Ingresa un nuevo nombre para este perfil.',
      namePlaceholder: 'Nombre del perfil',
      duplicateError: 'Ya existe un perfil con este nombre.',
      cancel: 'Cancelar',
      save: 'Guardar',
      limitTitle: 'Alcanzaste el límite de la cantidad de perfiles',
      limitDesc: (max) => `Has alcanzado el límite máximo de ${max} perfiles permitidos en tu cuenta. Para agregar uno nuevo, elimina o renombra alguno de los existentes.`,
      accept: 'Aceptar',
      deleteTitle: '¿Eliminar Perfil?',
      deleteDesc: (name) => `¿Estás seguro de que deseas eliminar el perfil "${name}"? Esta acción no se puede deshacer.`,
      onlyOneError: 'No puedes eliminar el único perfil que queda.',
      unsavedTitle: 'Cambios sin guardar',
      unsavedDesc: 'Tienes cambios sin guardar en esta página. Si cambias de perfil, se perderán. ¿Quieres continuar y descartarlos?',
      discard: 'Descartar Cambios',
    },
  },

  en: {
    nav: {
      dashboard: 'Dashboard',
      chat: 'Market Chat',
      emails: 'Emails',
      documents: 'Document Checker',
      loads: 'Loads',
      fleet: 'Fleet',
      drivers: 'Drivers',
      brokers: 'Brokers',
      calculator: 'Calculator',
      notifications: 'Notifications',
      profile: 'Profile',
      activeSession: 'Active session',
      account: 'Account',
      noEmail: 'No associated email',
      logout: 'Log out',
      openProfile: 'Open profile menu',
    },
    dashboard: {
      title: 'Operational Dashboard', organization: 'My organization', weeklyRevenue: 'Weekly Revenue',
      netProfit: 'Net Profit', averageRate: 'Average Rate/Mile', weeklyTrips: 'Trips This Week',
      loads: 'loads', estimatedThisWeek: 'estimated this week', target: 'target: $3.00/mile',
      inTransitNow: 'in transit now', fleetStatus: 'Fleet Status', viewAll: 'View all',
      noTrucks: 'No trucks registered', noDriver: 'No driver', documentAlerts: 'Document Alerts',
      next30Days: 'next 30 days', allDocumentsOk: 'All documents are in order', expired: 'EXPIRED',
      expires: 'Expires', topBrokers: 'Top Brokers', noBrokers: 'No brokers registered', recentLoads: 'Recent Loads',
      viewAllLoads: 'View all', noLoads: 'No loads registered yet', route: 'Route', miles: 'Miles',
      result: 'Result', broker: 'Broker', total: 'Total', error: 'Could not load dashboard data. Try reloading the page.',
      alertsAndNotifications: 'Alerts & Notifications', allInOrder: 'Everything is in order',
    },
    calculator: {
      title: 'Cost/Mile Calculator', subtitle: 'Calculate your break-even and minimum profitable rate',
      variables: 'Business Variables', diesel: 'Diesel price ($/gal)', mpg: 'Truck MPG', insurance: 'Insurance ($/week)',
      lease: 'Lease/rent ($/week)', driverPay: 'Driver pay %', otherCosts: 'Other expenses ($/week)',
      weeklyMiles: 'Average miles/week', targetRate: 'Target rate ($/mi)', results: 'Results', costPerMile: 'Cost per mile',
      dieselFixed: 'diesel + fixed costs', breakEven: 'Break-even', minimumRate: 'minimum rate', target: 'Target rate',
      profit: 'profit', profitable: 'Profitable', loss: 'Loss', earns: 'You earn', loses: 'You lose', rejectOrNegotiate: 'reject or negotiate',
      missing: 'Missing', cannotCalculate: 'a value: your cost per mile cannot be calculated.', saved: 'Saved', save: 'Save configuration',
      breakEvenLabel: 'Break-Even', targetLabel: 'Target', marketLabel: 'Florida\nMarket',
      accessorialsTitle: 'Additional Charges / Accessorials',
      enableCustom: 'Enable custom',
      customAccessorialsDesc: 'Enter your amounts for each fee. The chat will prioritize these values over market rates.',
      otherAccessorials: 'Other additional charges...',
    },
    common: {
      deleteConfirmTitle: 'Confirm Deletion',
      deleteTruckPrompt: (name) => `Do you want to delete Truck ${name}?`,
      deleteDriverPrompt: (name) => `Do you want to delete Driver ${name}?`,
      deleteBrokerPrompt: (name) => `Do you want to delete Broker ${name}?`,
      deleteLoadPrompt: 'Do you want to delete this Load?',
      cancel: 'Cancel',
      confirmDelete: 'Delete',
    },
    fleet: { title: 'Fleet', trucks: 'trucks', add: 'Add truck', available: 'Available', enRoute: 'En Route', yard: 'In Yard', maintenance: 'Maint.', edit: 'Edit Truck', new: 'New Truck', plate: 'Plate', model: 'Model', year: 'Year', status: 'Status', equipmentType: 'Equipment Type', assignedDriver: 'Assigned driver', chassis: 'Chassis #', chassisAvailable: 'Chassis available', notes: 'Notes', cancel: 'Cancel', save: 'Save', noTrucks: 'No trucks registered', noAssigned: 'Not assigned', availableText: 'Available', unavailable: 'Not available' },
    drivers: { title: 'Drivers', registered: 'registered', add: 'Add driver', edit: 'Edit Driver', new: 'New Driver', name: 'First name', lastName: 'Last name', phone: 'Phone', status: 'Status', license: 'CDL license #', licenseExpiry: 'License expiration', medicalExpiry: 'Medical expiration', twicExpiry: 'TWIC expiration', hazmatExpiry: 'HazMat expiration', assignedTruck: 'Assigned truck (plate)', notes: 'Notes', cancel: 'Cancel', save: 'Save', noDrivers: 'No drivers registered', noPhone: 'No phone', documentsOk: 'Documents up to date', expired: 'EXPIRED', expiresIn: 'expires in' },
    brokers: { title: 'Brokers', registered: 'registered', add: 'Add broker', edit: 'Edit Broker', new: 'New Broker', name: 'Name', contact: 'Contact', phone: 'Phone', avgRate: 'Average rate $/mi', paymentDays: 'Payment days', status: 'Status', reliability: 'Reliability (1-10)', timelyPayment: 'On-time payment (1-10)', clauses: 'Frequent clauses / alerts', notes: 'Notes', cancel: 'Cancel', save: 'Save', noBrokers: 'No brokers registered', noMc: 'No MC', noContact: 'No contact', loads: 'Loads', avgRateShort: 'Avg $/mi', payDays: 'Pay days' },
    loadsPage: { title: 'Loads', registered: 'registered', add: 'New load', revenue: 'Total billed', profit: 'Estimated profit', shown: 'Loads shown', avgRate: 'Average $/mi', all: 'All', inTransit: 'In transit', pending: 'Pending', delivered: 'Delivered', quickload: '$2.20/mi', gain: 'Profit', loss: 'Loss', noMatches: 'No loads match this filter', route: 'Route', broker: 'Broker', type: 'Type', miles: 'Miles', total: 'Total', result: 'Result', status: 'Status' },
    loadForm: {
      newTitle: 'New Load',
      editTitle: 'Edit Load',
      rpmPreview: '$/mile',
      dieselCost: 'Diesel cost',
      origin: 'Origin',
      destination: 'Destination',
      miles: 'Miles',
      offeredRate: 'Offered rate $',
      negotiatedRate: 'Negotiated rate $',
      dieselToday: 'Diesel price today $',
      broker: 'Broker',
      brokerPlaceholder: 'Broker name',
      type: 'Type',
      directBroker: 'Direct Broker',
      directClient: 'Direct Client',
      pickupDate: 'Pickup date',
      deliveryDate: 'Delivery date',
      status: 'Status',
      truckPlate: 'Truck plate',
      driver: 'Driver',
      driverPlaceholder: 'Driver name',
      notes: 'Notes',
      cancel: 'Cancel',
      save: 'Save load',
      required: '* Required field',
      pending: 'Pending',
      inTransit: 'In Transit',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    },
    statuses: {
      disponible: 'Available',
      en_ruta: 'En Route',
      en_yarda: 'In Yard',
      mantenimiento: 'Maintenance',
      activo: 'Active',
      inactivo: 'Inactive',
      vacaciones: 'Vacation',
      suspension: 'Suspended',
      precaucion: 'Caution',
      bloqueado: 'Blocked',
      pendiente: 'Pending',
      en_transito: 'In Transit',
      entregado: 'Delivered',
      cancelado: 'Cancelled',
      broker_directo: 'Direct Broker',
      cliente_directo: 'Direct Client',
    },
    documents: { title: 'Document Checker', subtitle: 'Rate Confirmations · Delivery Orders — operational, commercial and identity analysis', carrierMode: 'Carrier Mode — profitability and operations', dispatcherMode: 'Dispatcher Mode — completeness and assignment', pasteOrUpload: 'Paste text or upload the document', upload: 'Upload PDF / JPG / PNG / TXT', accepted: 'Accepts PDF, JPG, PNG, TXT — Rate Confirmations and Delivery Orders only', placeholder: 'Paste the Rate Confirmation or Delivery Order text here...', verify: 'Verify Document', extract: 'Extracting document data...', validate: 'Validating business rules...', verifyBroker: 'Verifying broker and carrier...', process: 'Processing file...', processError: 'Could not process the file. Try pasting the text directly.', unsupported: 'Unsupported format. Use PDF, JPG, PNG or TXT.', sensitive: 'For security, banking information and sensitive documents are not processed.', newAnalysis: 'New analysis', fromCache: 'From cache', confidence: 'Confidence', risk: 'Risk', registerLoad: 'Register load', mainAlerts: 'MAIN ALERTS', analysisByCategory: 'ANALYSIS BY CATEGORY', stepsToFollow: 'STEPS TO FOLLOW', critical: 'Critical', review: 'Review', ok: 'OK' },
    map: { title: 'Route Map', geolocated: 'geolocated loads · origin → destination', empty: 'No loads with recognized locations yet', origin: 'Origin', destination: 'Destination', rate: 'Rate' },
    notifications: { title: 'Notifications', markAll: 'Mark all', new: 'New', all: 'All', unread: 'Unread', high: 'High', medium: 'Medium', noNotifications: 'No notifications', formTitle: 'New Notification', titleLabel: 'Title', message: 'Message', type: 'Type', priority: 'Priority', send: 'Send', cancel: 'Cancel', justNow: 'just now', hoursAgo: 'ago', assignment: 'Assignment change', delay: 'Route delay', dispatch: 'Dispatch message', documentExpired: 'Document expired', rateAlert: 'Rate alert', general: 'General' },
    profiles: {
      loading: 'Loading Profile...',
      yourProfiles: 'Your Profiles',
      addNewProfile: 'Add new profile',
      rename: 'Rename',
      delete: 'Delete',
      createTitle: 'Create New Profile',
      renameTitle: 'Rename Profile',
      createDesc: 'Enter a name for your new configuration profile.',
      renameDesc: 'Enter a new name for this profile.',
      namePlaceholder: 'Profile name',
      duplicateError: 'A profile with this name already exists.',
      cancel: 'Cancel',
      save: 'Save',
      limitTitle: "You've reached the profile limit",
      limitDesc: (max) => `You have reached the maximum limit of ${max} profiles allowed on your account. To add a new one, delete or rename an existing profile.`,
      accept: 'Got it',
      deleteTitle: 'Delete Profile?',
      deleteDesc: (name) => `Are you sure you want to delete profile "${name}"? This action cannot be undone.`,
      onlyOneError: 'You cannot delete the only remaining profile.',
      unsavedTitle: 'Unsaved changes',
      unsavedDesc: 'You have unsaved changes on this page. If you switch profiles, they will be lost. Do you want to continue and discard them?',
      discard: 'Discard Changes',
    },
  },
};

export function LanguageProvider({ children }) {
  const { userProfile } = useAppState();

  const [locale, setLocaleState] = useState(() => {
    return localStorage.getItem('trucky_locale') || (userProfile?.idioma_chat === 'en' ? 'en' : 'es');
  });

  useEffect(() => {
    if (userProfile?.idioma_chat) {
      setLocaleState(userProfile.idioma_chat === 'en' ? 'en' : 'es');
      localStorage.setItem('trucky_locale', userProfile.idioma_chat === 'en' ? 'en' : 'es');
    }
  }, [userProfile?.idioma_chat]);

  const setLocale = async (nextLocale) => {
    if (!nextLocale) return;

    localStorage.setItem('trucky_locale', nextLocale);
    setLocaleState(nextLocale);
    window.dispatchEvent(new CustomEvent('trucky-locale-changed', { detail: nextLocale }));

    try {
      const user = await base44.auth.me();
      if (!user?.email) return;
      const profiles = await base44.entities.UserProfile.filter({
        usuario: user.email,
      });

      if (profiles.length > 0) {
        await base44.entities.UserProfile.update(profiles[0].id, {
          idioma_chat: nextLocale,
        });
      } else {
        await base44.entities.UserProfile.create({
          usuario: user.email,
          idioma_chat: nextLocale,
        });
      }
    } catch (error) {
      console.error('No se pudo guardar el idioma:', error);
    }
  };

  const value = {
    locale,
    setLocale,
    t: translations[locale] || translations.es,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage debe usarse dentro de LanguageProvider');
  }

  return context;
}