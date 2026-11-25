// F3-15 · Página de Configuración de la cuenta (se abre desde el menú Perfil).
// Fase 1: Idioma, Tema y accesos a Mis costos funcionan; el resto se habilita
// en las fases siguientes o queda inhabilitado por dependencias externas.
import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Calculator, Receipt, Lock, Hammer, Moon, Sun, ChevronRight, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import PersonalSection from './sections/PersonalSection';
import CompanySection from './sections/CompanySection';
import PlanSection from './sections/PlanSection';
import TemplatesSection from './sections/TemplatesSection';
import PrivacySection from './sections/PrivacySection';
import HelpSection from './sections/HelpSection';
import AccessibilitySection from './sections/AccessibilitySection';
import NotificationsSection from './sections/NotificationsSection';
import InviteSection from './sections/InviteSection';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS, findSection, sectionLabel } from './settingsSections';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

function Pill({ children, tone = 'muted' }) {
  const tones = { muted: 'bg-muted text-muted-foreground', amber: 'bg-amber-500/15 text-t-warning' };
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>;
}

function LanguageSection({ locale, setLocale }) {
  const opts = [{ id: 'es', label: 'Español' }, { id: 'en', label: 'English' }];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {tx(locale, 'Es la preferencia de tu cuenta: cambia toda la aplicación, incluido el chat.', 'This is your account preference: it changes the whole app, including the chat.')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        {opts.map((o) => (
          <button key={o.id} type="button" onClick={() => setLocale(o.id)}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors ${locale === o.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}>
            <span>{o.label} <span className="text-xs opacity-60">({o.id.toUpperCase()})</span></span>
            {locale === o.id && <Check className="w-4 h-4 text-t-text-accent" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeSection({ locale }) {
  const { theme, setTheme } = useTheme();
  const opts = [
    { id: 'dark', icon: Moon, label: tx(locale, 'Modo oscuro', 'Dark mode') },
    { id: 'light', icon: Sun, label: tx(locale, 'Modo claro', 'Light mode') },
  ];
  return (
    <div className="space-y-3">
      <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        {opts.map(({ id, icon: Icon, label }) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors ${theme === id ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}>
            <span className="flex items-center gap-2"><Icon className="w-4 h-4" /> {label}</span>
            {theme === id && <Check className="w-4 h-4 text-t-text-accent" />}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{tx(locale, 'Se guarda en este navegador.', 'Saved in this browser.')}</p>
    </div>
  );
}

function CostsSection({ locale }) {
  const items = [
    { to: '/calculadora', icon: Calculator, title: tx(locale, 'Calculadora de costos', 'Cost calculator'), desc: tx(locale, 'Diésel, MPG, pago al conductor y tu costo por milla.', 'Diesel, MPG, driver pay and your cost per mile.') },
    { to: '/calculadora#cargos', icon: Receipt, title: tx(locale, 'Mis cargos adicionales', 'My extra charges'), desc: tx(locale, 'Tus propios montos de Pre-Pull, Hazmat, Detention y otros.', 'Your own Pre-Pull, Hazmat, Detention and other amounts.') },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map(({ to, icon: Icon, title, desc }) => (
        <Link key={to} to={to} className="group rounded-xl border border-border bg-card hover:bg-muted p-4 flex items-start gap-3 transition-colors">
          <Icon className="w-5 h-5 text-t-text-accent mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
        </Link>
      ))}
    </div>
  );
}

function Placeholder({ section, locale }) {
  const disabled = section.status === 'disabled';
  const Icon = disabled ? Lock : Hammer;
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
      <Icon className="w-6 h-6 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{disabled ? tx(locale, 'Próximamente', 'Coming soon') : tx(locale, 'En construcción', 'Under construction')}</p>
      <p className="text-xs text-muted-foreground">
        {disabled ? (locale === 'en' ? section.reason?.en : section.reason?.es) : tx(locale, 'Esta sección se habilita en una próxima actualización.', 'This section will be enabled in an upcoming update.')}
      </p>
    </div>
  );
}

export default function Settings() {
  const { seccion } = useParams();
  const navigate = useNavigate();
  const { locale, setLocale } = useLanguage();
  const { user } = useAuth();
  const current = findSection(seccion) || findSection('idioma');
  const correo = user?.email || '';
  const nombre = user?.full_name || correo.split('@')[0] || '';
  const inicial = (nombre || '?').charAt(0).toUpperCase();

  // Volver a Trucky: siempre a la página principal (antes retrocedía por cada
  // sección visitada dentro de Configuración).
  const volver = () => navigate('/');

  const body = current.status === 'ready'
    ? (current.id === 'perfil' ? <PersonalSection locale={locale} />
      : current.id === 'empresa' ? <CompanySection locale={locale} />
      : current.id === 'plan' ? <PlanSection locale={locale} />
      : current.id === 'plantillas' ? <TemplatesSection locale={locale} />
      : current.id === 'idioma' ? <LanguageSection locale={locale} setLocale={setLocale} />
      : current.id === 'tema' ? <ThemeSection locale={locale} />
      : current.id === 'costos' ? <CostsSection locale={locale} />
      : current.id === 'privacidad' ? <PrivacySection locale={locale} />
      : current.id === 'ayuda' ? <HelpSection locale={locale} />
      : current.id === 'accesibilidad' ? <AccessibilitySection locale={locale} />
      : current.id === 'notificaciones' ? <NotificationsSection locale={locale} />
      : current.id === 'invita' ? <InviteSection locale={locale} /> : null)
    : <Placeholder section={current} locale={locale} />;

  const NavItem = ({ s }) => {
    const Icon = s.icon;
    const active = s.id === current.id;
    const disabled = s.status === 'disabled';
    const cls = `w-full flex items-center gap-3 h-10 px-4 rounded-full text-sm transition-colors ${active ? 'bg-t-bg-canvas text-t-text-accent font-medium' : disabled ? 'text-t-text-disabled cursor-not-allowed' : 'text-t-text-secondary hover:bg-t-action-secondary hover:text-t-text-primary'}`;
    const inner = (<><Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-t-text-accent' : ''}`} /><span className="flex-1 truncate text-left">{sectionLabel(s, locale)}</span>{disabled && <Lock className="w-3 h-3" />}</>);
    return disabled
      ? <div className={cls} aria-disabled="true" title={locale === 'en' ? s.reason?.en : s.reason?.es}>{inner}</div>
      : <Link to={`/configuracion/${s.id}`} className={cls} aria-current={active ? 'page' : undefined}>{inner}</Link>;
  };

  return (
    // Pantalla completa: la configuración tapa el menú y los módulos de la app.
    <div className="fixed inset-0 z-40 flex bg-t-bg-deep text-foreground md:p-3 md:gap-3">
      {/* Barra lateral de configuración (escritorio) */}
      <aside className="hidden md:flex w-72 flex-shrink-0 flex-col rounded-3xl bg-t-bg-sidebar shadow-card">
        <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
          <button type="button" onClick={volver} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> {tx(locale, 'Volver', 'Back')}
          </button>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-t-action-primary border border-t-border-strong flex items-center justify-center text-sm font-bold text-white">{inicial}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{tx(locale, 'Configuración', 'Settings')}</div>
              <div className="text-xs text-muted-foreground truncate">{correo}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.id} className="space-y-0.5">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{locale === 'en' ? g.en : g.es}</div>
              {SETTINGS_SECTIONS.filter((s) => s.group === g.id).map((s) => <NavItem key={s.id} s={s} />)}
            </div>
          ))}
        </nav>
      </aside>

      {/* Contenido */}
      <main className="flex-1 min-w-0 flex flex-col bg-t-bg-canvas md:rounded-3xl overflow-hidden">
        {/* Celular: volver + selector de sección */}
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-border bg-t-bg-sidebar">
          <button type="button" onClick={volver} aria-label={tx(locale, 'Volver', 'Back')} className="p-1.5 rounded-lg hover:bg-foreground/5"><ArrowLeft className="w-5 h-5" /></button>
          <select className="flex-1 min-w-0 bg-t-bg-input border border-border rounded-xl px-3 py-2 text-sm"
            value={current.id} onChange={(e) => navigate(`/configuracion/${e.target.value}`)}>
            {SETTINGS_SECTIONS.map((s) => (
              <option key={s.id} value={s.id} disabled={s.status === 'disabled'}>
                {sectionLabel(s, locale)}{s.status === 'disabled' ? ` · ${tx(locale, 'Próximamente', 'Coming soon')}` : ''}
              </option>
            ))}
          </select>
        </div>

        <header className="px-6 md:px-10 pt-6 md:pt-8 pb-5 border-b border-border">
          <h1 className="t-h1 flex items-center gap-3">
            <current.icon className="w-7 h-7 lg:w-8 lg:h-8 text-t-text-accent" /> {sectionLabel(current, locale)}
          </h1>
          <p className="t-subtitle mt-1">{locale === 'en' ? current.desc?.en : current.desc?.es}</p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 md:px-10 py-6">
          <div className="max-w-3xl">{body}</div>
        </div>
      </main>
    </div>
  );
}
