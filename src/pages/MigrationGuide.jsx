import React from 'react';
import { Download, Server, Database, Lock, Code, ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react';

const sections = [
  {
    icon: Code,
    color: 'text-cyan-400',
    bg: 'bg-cyan-400/10',
    border: 'border-cyan-400/20',
    title: '1. Exportar el Código Frontend',
    steps: [
      'Ve a Panel → Código → GitHub Sync en Base44',
      'Conecta tu repositorio GitHub',
      'El código React (páginas, componentes) se sincronizará automáticamente',
      'Clona el repositorio a tu máquina local con: git clone <tu-repo>',
      'Instala dependencias: npm install',
      'Para desarrollo local: npm run dev',
    ],
    note: 'El frontend puede desplegarse en Vercel, Netlify o cualquier servidor estático.',
  },
  {
    icon: Server,
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/20',
    title: '2. Migrar las Funciones Backend',
    steps: [
      'Las funciones Deno también se exportan al repo de GitHub',
      'Opción A — Deno Deploy: la más compatible, sin cambios de código',
      'Opción B — Supabase Edge Functions: requiere ajustes menores de imports',
      'Opción C — Cloudflare Workers: requiere adaptar la estructura del handler',
      'Configura las variables de entorno (API keys) en la nueva plataforma',
      'Actualiza las URLs de los endpoints en el frontend',
    ],
    note: 'Deno Deploy es la opción más directa por compatibilidad nativa con el runtime.',
  },
  {
    icon: Database,
    color: 'text-green-400',
    bg: 'bg-green-400/10',
    border: 'border-green-400/20',
    title: '3. Migrar la Base de Datos',
    steps: [
      'Exporta los datos desde Panel → Datos en Base44 (formato JSON)',
      'Elige tu nueva base de datos: Supabase (recomendado), PlanetScale o MongoDB Atlas',
      'Crea las colecciones/tablas equivalentes a las entidades de Base44',
      'Importa los datos exportados a la nueva base de datos',
      'Actualiza las llamadas al SDK de Base44 por las del nuevo proveedor',
    ],
    note: 'Supabase es la alternativa más completa: incluye base de datos, storage y API REST automática.',
  },
  {
    icon: Lock,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/20',
    title: '4. Reemplazar la Autenticación',
    steps: [
      'Base44 maneja auth internamente — debes reemplazarlo',
      'Opción A — Clerk: la más fácil de integrar con React',
      'Opción B — Supabase Auth: ideal si ya usas Supabase para la DB',
      'Opción C — Auth0: más robusto para proyectos enterprise',
      'Reemplaza todas las llamadas a base44.auth.me() por la nueva solución',
      'Actualiza los guards de rutas y el manejo de sesiones',
    ],
    note: 'Si usas Supabase para DB, usa también Supabase Auth para simplificar la integración.',
  },
];

const difficult = [
  { label: 'Sistema de autenticación', detail: 'Reemplazar con Clerk, Auth0 o Supabase Auth' },
  { label: 'Integraciones LLM nativas', detail: 'Conectar directamente con OpenAI / Anthropic API' },
  { label: 'Envío de emails', detail: 'Usar Resend, SendGrid o AWS SES' },
  { label: 'Storage de archivos', detail: 'Usar Supabase Storage, S3 o Cloudflare R2' },
];

const recommended = [
  { step: '1', label: 'GitHub Sync', detail: 'Exporta el código a tu repositorio' },
  { step: '2', label: 'Supabase', detail: 'Base de datos + Auth + Storage en un solo lugar' },
  { step: '3', label: 'Deno Deploy', detail: 'Backend functions sin cambios de código' },
  { step: '4', label: 'Vercel / Netlify', detail: 'Hosting del frontend React' },
];

export default function MigrationGuide() {
  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Print button — hidden on print */}
      <div className="print:hidden sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <Server className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold">Guía de Migración — Trucky</span>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all"
        >
          <Download className="w-4 h-4" /> Descargar / Imprimir
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-semibold mb-2">
            GUÍA TÉCNICA
          </div>
          <h1 className="text-3xl font-bold text-foreground">Migración a Servidor Privado</h1>
          <p className="text-muted-foreground text-sm">Trucky — Larcofer USA · Generado el {new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        {/* Intro */}
        <div className="bg-card border border-border rounded-xl p-5 text-sm text-muted-foreground leading-relaxed">
          Este documento describe el proceso para migrar la aplicación <strong className="text-foreground">Trucky</strong> fuera de la plataforma Base44 hacia infraestructura propia. La migración implica cuatro capas independientes: frontend, backend, base de datos y autenticación.
        </div>

        {/* Main sections */}
        {sections.map((sec) => (
          <div key={sec.title} className={`rounded-xl border ${sec.border} overflow-hidden`}>
            <div className={`flex items-center gap-3 px-5 py-4 ${sec.bg}`}>
              <div className={`w-8 h-8 rounded-lg ${sec.bg} border ${sec.border} flex items-center justify-center`}>
                <sec.icon className={`w-4 h-4 ${sec.color}`} />
              </div>
              <h2 className={`text-sm font-bold ${sec.color}`}>{sec.title}</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              {sec.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full ${sec.bg} border ${sec.border} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <span className={`text-xs font-bold ${sec.color}`}>{i + 1}</span>
                  </div>
                  <p className="text-sm text-foreground">{s}</p>
                </div>
              ))}
              <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg ${sec.bg} border ${sec.border}`}>
                <CheckCircle className={`w-3.5 h-3.5 ${sec.color} flex-shrink-0 mt-0.5`} />
                <p className={`text-xs ${sec.color}`}>{sec.note}</p>
              </div>
            </div>
          </div>
        ))}

        {/* Difficult parts */}
        <div className="rounded-xl border border-yellow-400/20 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-yellow-400/10">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <h2 className="text-sm font-bold text-yellow-400">Aspectos que requieren más trabajo</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {difficult.map((d, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <span className="text-sm font-medium text-foreground">{d.label}</span>
                <span className="text-xs text-muted-foreground text-right max-w-xs">{d.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended stack */}
        <div className="rounded-xl border border-primary/20 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-primary/10">
            <Server className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-primary">Stack Recomendado</h2>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-col sm:flex-row items-center gap-2">
              {recommended.map((r, i) => (
                <React.Fragment key={r.step}>
                  <div className="flex-1 bg-muted rounded-xl p-3 text-center">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center mx-auto mb-1">{r.step}</div>
                    <p className="text-xs font-bold text-foreground">{r.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
                  </div>
                  {i < recommended.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 hidden sm:block" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground border-t border-border pt-6">
          Trucky · Larcofer USA · Documento generado automáticamente
        </p>
      </div>
    </div>
  );
}