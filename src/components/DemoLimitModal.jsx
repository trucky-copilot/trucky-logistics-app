import React from 'react';
import { Sparkles, ExternalLink, X } from 'lucide-react';

export default function DemoLimitModal({ isOpen, onClose, entityName = 'elementos', limit = 3 }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#12121a] border border-violet-500/30 rounded-2xl w-full max-w-md p-6 text-center shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-violet-600/30 via-purple-600/20 to-indigo-600/30 border border-violet-500/40 flex items-center justify-center shadow-lg shadow-violet-500/10">
          <Sparkles className="w-7 h-7 text-violet-400" />
        </div>

        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30 mb-3">
          DEMO GRATUITA · LÍMITE ALCANZADO
        </span>

        <h3 className="text-lg font-bold text-white mb-2">
          Has alcanzado el límite de {limit} {entityName}
        </h3>

        <p className="text-xs text-zinc-300 leading-relaxed mb-6">
          La versión demo te permite registrar hasta {limit} {entityName} para probar la plataforma. 
          Desbloquea registros ilimitados, sincronización completa y análisis avanzado con la versión completa.
        </p>

        <div className="space-y-2.5">
          <a
            href="https://trucky.site"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.01]"
          >
            <span>Activar versión completa</span>
            <ExternalLink className="w-4 h-4" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            Entendido, volver
          </button>
        </div>
      </div>
    </div>
  );
}
