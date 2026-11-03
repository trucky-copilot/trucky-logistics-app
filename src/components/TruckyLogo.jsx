import React from 'react';

/**
 * Componente de Marca Oficial de Trucky (#5B2BA0 y Blanco).
 * - TruckyLogoIcon: Ícono cuadrado exclusivamente con el símbolo/isotipo de Trucky en blanco sobre fondo #5B2BA0 (sin letras).
 * - TruckyLogoBanner: Logotipo horizontal completo de Trucky.
 */
export function TruckyLogoIcon({ className = 'w-9 h-9', rounded = 'rounded-xl' }) {
  return (
    <div
      className={`${className} ${rounded} relative overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#5B2BA0] border border-white/15 shadow-lg shadow-[#5B2BA0]/35`}
    >
      <img
        src="/trucky-symbol.png?v=2"
        alt="Trucky"
        className="w-full h-full object-contain select-none pointer-events-none p-0.5"
      />
    </div>
  );
}

export function TruckyLogoBanner({ className = 'h-9 w-28', rounded = 'rounded-xl' }) {
  return (
    <div
      className={`${className} ${rounded} relative overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#5B2BA0] border border-white/15 shadow-lg shadow-[#5B2BA0]/35`}
    >
      <img
        src="/trucky-logo.png"
        alt="Trucky"
        className="w-full h-full object-cover select-none pointer-events-none"
        style={{
          objectPosition: 'center 50%',
          transform: 'scale(1.22)',
        }}
      />
    </div>
  );
}

/**
 * Logotipo completo (el mismo de la barra lateral): recuadro morado #4F1984
 * con el logotipo blanco. `imgClass` controla el alto.
 */
export function TruckyWordmark({ imgClass = 'h-6', className = '' }) {
  return (
    <div className={`rounded-xl bg-[#4F1984] border border-white/15 shadow-lg shadow-[#4F1984]/40 px-3 py-2 inline-flex flex-shrink-0 ${className}`}>
      <img src="/trucky-wordmark.png" alt="Trucky" className={`${imgClass} w-auto select-none pointer-events-none`} draggable={false} />
    </div>
  );
}

export default TruckyLogoIcon;
