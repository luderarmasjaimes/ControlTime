import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { applyHtmlLang, getPlatformPrefs } from './auth/platformPrefs'
import { initMiningLocations } from './config/miningLocations'

applyHtmlLang(getPlatformPrefs().languageCode)

// Sincronizar localizaciones oficiales desde el backend
initMiningLocations();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
