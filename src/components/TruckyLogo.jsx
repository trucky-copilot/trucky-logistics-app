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

export default TruckyLogoIcon;
