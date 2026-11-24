// Primero: capturar el enlace de facturación antes de que otro módulo toque la URL.
import '@/lib/billingLinkCapture'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from '@/App.jsx'
import { ThemeProvider } from '@/lib/ThemeContext'
import { readPrefs, applyAccessibility, PREFS_EVENT } from '@/lib/userPreferences'
import '@/theme/trucky-tokens.css'
import '@/index.css'

// F3-15 fase 7: tamaño de texto, reducir movimiento y alto contraste antes del primer render.
applyAccessibility(readPrefs().accesibilidad)

// reducedMotion="user": si el SO pide reducir movimiento, framer-motion desactiva
// las animaciones de transform/layout; "always" cuando se pide en Configuración.
function MotionRoot({ children }) {
  const [reducir, setReducir] = React.useState(() => readPrefs().accesibilidad.reducir_movimiento)
  React.useEffect(() => {
    const on = (e) => setReducir(Boolean(e.detail?.accesibilidad?.reducir_movimiento))
    window.addEventListener(PREFS_EVENT, on)
    return () => window.removeEventListener(PREFS_EVENT, on)
  }, [])
  return <MotionConfig reducedMotion={reducir ? 'always' : 'user'}>{children}</MotionConfig>
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <MotionRoot>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </MotionRoot>
)
