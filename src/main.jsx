// Primero: capturar el enlace de facturación antes de que otro módulo toque la URL.
import '@/lib/billingLinkCapture'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  // reducedMotion="user": si el SO pide reducir movimiento, framer-motion
  // desactiva las animaciones de transform/layout (whileHover, layoutId, y…)
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>
)
