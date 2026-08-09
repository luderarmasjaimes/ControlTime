/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG?: string;
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Sin tipos oficiales/@types disponibles; usado solo en componentes de gráficos livianos.
declare module 'react-plotly.js';
declare module 'react-plotly.js/factory';
declare module 'plotly.js-basic-dist-min';
// @types/leaflet no está instalado; mapas usan la API dinámicamente (any).
declare module 'leaflet';
