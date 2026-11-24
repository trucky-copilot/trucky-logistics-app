import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createLocalEmailMiddleware } from './src/server/localEmailMiddleware.js'

function localEmailPlugin() {
  return {
    name: 'local-email-dev-server',
    configureServer(server) {
      server.middlewares.use(createLocalEmailMiddleware(process.cwd()));
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  // Una sola copia de React: si el optimizador de dependencias descubre un
  // entry nuevo a mitad de sesión (p. ej. react/jsx-dev-runtime), se recarga
  // con otra copia de React y los hooks fallan con "Cannot read properties of
  // null (reading 'useState')". Con dedupe + include todo entra en la misma
  // optimización desde el arranque.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  plugins: [
    localEmailPlugin(),
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});