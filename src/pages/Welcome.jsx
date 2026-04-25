import { Truck, Shield, BarChart3, FileSearch } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const FEATURES = [
  { icon: FileSearch, label: 'Verifica Rate Confirmations', desc: 'Análisis automático de documentos con IA' },
  { icon: BarChart3,  label: 'Calcula rentabilidad',        desc: 'Tarifa por milla, break-even y objetivos' },
  { icon: Truck,      label: 'Gestiona tu flota',            desc: 'Conductores, camiones y cargas en un solo lugar' },
  { icon: Shield,     label: 'Datos 100% privados',          desc: 'Cada empresa opera en su propio espacio' },
];

export default function Welcome() {
  const handleLogin = () => base44.auth.redirectToLogin(window.location.href);

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0">
          <img
            src="https://media.base44.com/images/public/69e8214a181314e517a283d5/ef839c541_LARCOFERLOGO.png"
            alt="Larcofer Logo"
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <div className="text-2xl font-black text-foreground tracking-wide">TRUCKY</div>
          <div className="text-xs text-muted-foreground font-medium">LARCOFER USA</div>
        </div>
      </div>

      {/* Headline */}
      <div className="text-center mb-8 max-w-sm">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Operaciones de transporte,{' '}
          <span className="text-primary">sin complicaciones</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Plataforma para carriers y dispatchers intermodales. Crea tu cuenta gratuita y comienza hoy.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-2 gap-3 mb-8 w-full max-w-sm">
        {FEATURES.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1.5">
            <Icon className="w-4 h-4 text-primary" />
            <div className="text-xs font-semibold text-foreground">{label}</div>
            <div className="text-[11px] text-muted-foreground leading-snug">{desc}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={handleLogin}
          className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-sm font-bold text-primary-foreground transition-all"
        >
          Crear cuenta o iniciar sesión
        </button>
        <p className="text-center text-[11px] text-muted-foreground">
          Al registrarte, se crea tu propio espacio de trabajo privado.<br />
          Tus datos nunca se mezclan con los de otras empresas.
        </p>
      </div>
    </div>
  );
}