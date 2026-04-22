import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Zap, Truck, Users, LayoutDashboard, ChevronRight, Check } from 'lucide-react';

const STEPS = [
  {
    id: 'rol',
    pregunta: '¿Cuál es tu rol en la operación?',
    opciones: [
      { value: 'carrier', label: 'Carrier', desc: 'Tengo mi propio camión y lo manejo yo', icon: Truck },
      { value: 'dispatcher', label: 'Dispatcher', desc: 'Gestiono camiones de otros operadores', icon: Users },
      { value: 'ambos', label: 'Ambos', desc: 'Tengo camiones propios y también gestiono otros', icon: LayoutDashboard },
    ],
  },
  {
    id: 'cantidad_camiones',
    pregunta: '¿Cuántos camiones gestionas actualmente?',
    opciones: [
      { value: '1', label: '1 camión', desc: 'Operación individual' },
      { value: '2-5', label: '2 – 5 camiones', desc: 'Flota pequeña' },
      { value: '6-10', label: '6 – 10 camiones', desc: 'Flota mediana' },
      { value: '10+', label: '10+ camiones', desc: 'Flota grande' },
    ],
  },
  {
    id: 'costos',
    pregunta: '¿Ya tienes datos de costos para configurar la calculadora?',
    opciones: [
      { value: 'ahora', label: 'Configurar ahora', desc: 'Quiero ingresar mis costos de operación' },
      { value: 'despues', label: 'Lo hago después', desc: 'Entrar al dashboard primero' },
    ],
  },
];

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);

  const currentStep = STEPS[step];

  const handleSelect = async (value) => {
    const newAnswers = { ...answers, [currentStep.id]: value };
    setAnswers(newAnswers);

    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      // Final step — save profile
      setLoading(true);
      const user = await base44.auth.me();
      await base44.entities.UserProfile.create({
        usuario: user.email,
        rol: newAnswers.rol,
        cantidad_camiones: newAnswers.cantidad_camiones,
        onboarding_completado: true,
      });
      onComplete(newAnswers);
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground tracking-wide">TRUCKY</div>
            <div className="text-xs text-muted-foreground font-medium">LARCOFER USA</div>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-8 bg-primary' : i < step ? 'w-4 bg-primary/50' : 'w-4 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Question */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-1">
              Paso {step + 1} de {STEPS.length}
            </p>
            <h2 className="text-lg font-bold text-foreground">{currentStep.pregunta}</h2>
          </div>

          <div className="space-y-2.5">
            {currentStep.opciones.map((opcion) => {
              const Icon = opcion.icon;
              return (
                <button
                  key={opcion.value}
                  onClick={() => handleSelect(opcion.value)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group disabled:opacity-50"
                >
                  {Icon && (
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                      <Icon className="w-4.5 h-4.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{opcion.label}</div>
                    <div className="text-xs text-muted-foreground">{opcion.desc}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Configurando tu espacio de trabajo...
          </div>
        )}
      </div>
    </div>
  );
}