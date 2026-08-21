import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './a11y-form-base.css'  // ADR-106: Accesibilidad WCAG 2.1 AA
import { applyHtmlLang, getPlatformPrefs } from './auth/platformPrefs'
import { initMiningLocations } from './config/miningLocations'
import { log } from './lib/logger'
import { I18nProvider } from './i18n/I18nProvider'

applyHtmlLang(getPlatformPrefs().languageCode, getPlatformPrefs().countryIso2)

// Sincronizar localizaciones oficiales desde el backend
initMiningLocations();

// Cacheo de tiles de mapas para operación offline en unidades mineras con
// conectividad limitada (ver connectivityMonitor.ts + MapViewer.tsx).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/tile-cache-sw.js').catch((err) => {
      log.error('No se pudo registrar tile-cache-sw.js', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
