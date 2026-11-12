// F3-15 · Perfil de configuración — las secciones del menú, en el orden del ticket.
//
// status:
//   'ready'    → funciona.
//   'building' → se habilita en una fase siguiente de F3-15 (se ve, pero sin contenido aún).
//   'disabled' → depende de algo externo (limitación de Base44, mockup, textos
//                legales o comercial): se muestra inhabilitada con "Próximamente".
import {
  User, Building2, CreditCard, Languages, Moon, Accessibility, Bell, Calculator,
  FileText, Gift, MonitorSmartphone, ShieldCheck, KeyRound, LifeBuoy,
} from 'lucide-react';

export const SETTINGS_SECTIONS = [
  { id: 'perfil', group: 'cuenta', desc: { es: 'Tu nombre, teléfono, MC y DOT.', en: 'Your name, phone, MC and DOT.' }, icon: User, status: 'ready', es: 'Perfil personal', en: 'Personal profile' },
  { id: 'empresa', group: 'cuenta', desc: { es: 'Nombre de la empresa y tipos de camión.', en: 'Company name and truck types.' }, icon: Building2, status: 'ready', es: 'Empresa y equipos', en: 'Company & equipment' },
  { id: 'plan', group: 'cuenta', desc: { es: 'Tu suscripción, período gratis y cobros.', en: 'Your subscription, free period and charges.' }, icon: CreditCard, status: 'ready', es: 'Mi plan', en: 'My plan' },
  { id: 'idioma', group: 'preferencias', desc: { es: 'Preferencia de idioma de tu cuenta.', en: 'Your account language preference.' }, icon: Languages, status: 'ready', es: 'Idioma', en: 'Language' },
  { id: 'tema', group: 'preferencias', desc: { es: 'Apariencia de la aplicación.', en: 'App appearance.' }, icon: Moon, status: 'ready', es: 'Tema', en: 'Theme' },
  { id: 'accesibilidad', group: 'preferencias', desc: { es: 'Opciones para facilitar el uso.', en: 'Options that make the app easier to use.' }, icon: Accessibility, status: 'disabled', es: 'Accesibilidad', en: 'Accessibility',
    reason: { es: 'Pendiente del diseño (mockup).', en: 'Pending design (mockup).' } },
  { id: 'notificaciones', group: 'preferencias', desc: { es: 'Qué avisos quieres recibir.', en: 'Which alerts you want to receive.' }, icon: Bell, status: 'disabled', es: 'Notificaciones', en: 'Notifications',
    reason: { es: 'Pendiente del diseño (mockup).', en: 'Pending design (mockup).' } },
  { id: 'costos', group: 'herramientas', desc: { es: 'Tu calculadora y tus cargos adicionales.', en: 'Your calculator and extra charges.' }, icon: Calculator, status: 'ready', es: 'Mis costos y cargos', en: 'My costs & charges' },
  { id: 'plantillas', group: 'herramientas', desc: { es: 'Tus propias plantillas para los correos del chat.', en: 'Your own templates for chat emails.' }, icon: FileText, status: 'ready', es: 'Plantillas de correo', en: 'Email templates' },
  { id: 'invita', group: 'herramientas', desc: { es: 'Tu código de referido.', en: 'Your referral code.' }, icon: Gift, status: 'disabled', es: 'Invita y gana', en: 'Invite & earn',
    reason: { es: 'Disponible cuando se definan las condiciones del programa de referidos.', en: 'Available once the referral program terms are defined.' } },
  { id: 'dispositivos', group: 'seguridad', desc: { es: 'Equipos donde tienes la sesión abierta.', en: 'Devices where you are signed in.' }, icon: MonitorSmartphone, status: 'disabled', es: 'Mis dispositivos', en: 'My devices',
    reason: { es: 'En evaluación por limitaciones de la plataforma.', en: 'Under review due to platform limitations.' } },
  { id: 'seguridad', group: 'seguridad', desc: { es: 'Verificación en dos pasos.', en: 'Two-step verification.' }, icon: KeyRound, status: 'disabled', es: 'Seguridad', en: 'Security',
    reason: { es: 'Verificación en dos pasos: en evaluación por limitaciones de la plataforma.', en: 'Two-step verification: under review due to platform limitations.' } },
  { id: 'privacidad', group: 'seguridad', desc: { es: 'Términos, privacidad y tus datos.', en: 'Terms, privacy and your data.' }, icon: ShieldCheck, status: 'building', es: 'Privacidad y datos', en: 'Privacy & data' },
  { id: 'ayuda', group: 'soporte', desc: { es: 'Canal de contacto y guía de ayuda.', en: 'Contact channel and help guide.' }, icon: LifeBuoy, status: 'building', es: 'Ayuda y soporte', en: 'Help & support' },
];

export const SETTINGS_GROUPS = [
  { id: 'cuenta', es: 'Cuenta', en: 'Account' },
  { id: 'preferencias', es: 'Preferencias', en: 'Preferences' },
  { id: 'herramientas', es: 'Herramientas', en: 'Tools' },
  { id: 'seguridad', es: 'Seguridad y privacidad', en: 'Security & privacy' },
  { id: 'soporte', es: 'Soporte', en: 'Support' },
];

export const sectionLabel = (s, locale) => (locale === 'en' ? s.en : s.es);
export const findSection = (id) => SETTINGS_SECTIONS.find((s) => s.id === id);
