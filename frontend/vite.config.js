import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                // ADR-016: entry point aislado para el export PDF server-side
                // (Chromium headless navega aquí, ver pdf-export-service/).
                printReport: resolve(import.meta.dirname, 'print-report.html'),
            },
            output: {
                /**
                 * Separa las librerías pesadas en chunks propios (2026-08-02).
                 *
                 * Sin esto, Rollup metía casi todo en `main-*.js` (4.26MB) y
                 * duplicaba parte en `ReadOnlyViewer-*.js` (5.03MB): ~9.3MB de
                 * JS para abrir el login. Cada librería aquí la usa UNA familia
                 * de vistas, que ahora se cargan con React.lazy (ver App.tsx),
                 * así que sacarlas a su propio chunk significa que solo se
                 * descargan cuando el usuario abre esa vista.
                 *
                 * Además son chunks estables: cambiar código propio ya no
                 * invalida la caché de echarts/three/plotly en el navegador
                 * (los assets van con `immutable` a 1 año, ver nginx.conf).
                 *
                 * Solo se nombran las librerías grandes y de tipo "hoja"; para
                 * el resto se devuelve undefined y decide Rollup (un catch-all
                 * `vendor` puede alterar el orden de inicialización entre
                 * chunks y romper dependencias circulares legítimas).
                 */
                manualChunks(id) {
                    if (!id.includes('node_modules')) return
                    const m = id.split('node_modules/')[1] || ''
                    // Cubre tanto `plotly.js-basic-dist-min` (el que se usa) como
                    // `plotly.js`/`react-plotly.js`, que siguen en node_modules
                    // como dependencia transitiva de react-plotly.js.
                    if (m.startsWith('plotly.js') || m.startsWith('react-plotly.js')) return 'vendor-plotly'
                    if (m.startsWith('echarts') || m.startsWith('zrender')) return 'vendor-echarts'
                    if (m.startsWith('three') || m.startsWith('@react-three')) return 'vendor-three'
                    if (m.startsWith('konva') || m.startsWith('react-konva')) return 'vendor-konva'
                    if (m.startsWith('leaflet')) return 'vendor-leaflet'
                    if (m.startsWith('sql.js')) return 'vendor-sqljs'
                    if (m.startsWith('html2canvas')) return 'vendor-html2canvas'
                    if (m.startsWith('@tiptap') || m.startsWith('prosemirror')) return 'vendor-tiptap'
                    if (m.startsWith('hls.js')) return 'vendor-hls'
                    return undefined
                },
            },
        },
    },
    server: {
        port: 5173,
        headers: {
            'Cache-Control': 'no-store',
        },
        proxy: {
            '/api': 'http://localhost:8082',
            '/ws': {
                target: 'ws://localhost:8082',
                ws: true
            },
            // Motor FORMULA: el contenedor ya no publica el puerto 18020 en el
            // host (solo `expose: 8020`, red interna de compose) — se enruta a
            // través del nginx de producción (beemetry-web, host :5173), que es
            // quien hace el rewrite del prefijo /formula-api E inyecta el
            // header Authorization del motor (ver frontend/nginx.conf). Por eso
            // aquí NO se hace rewrite: el prefijo debe llegar intacto a nginx.
            '/formula-api/ws': {
                target: 'ws://localhost:5173',
                ws: true,
            },
            '/formula-api': {
                target: 'http://localhost:5173',
                changeOrigin: true,
            },
            '/tiles': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/tiles/, ''),
            },
        }
    },
    // `vite preview` no hereda el proxy del dev server; sin esto, /api apunta al puerto del preview (p. ej. 8021) y falla con "Failed to fetch".
    preview: {
        port: 4173,
        proxy: {
            '/api': 'http://localhost:8082',
            '/ws': {
                target: 'ws://localhost:8082',
                ws: true
            },
            // Mismo criterio que server.proxy: enrutar FORMULA via el nginx
            // de producción en :5173 (rewrite + token server-side), sin
            // depender del puerto 18020 que ya no se publica.
            '/formula-api/ws': {
                target: 'ws://localhost:5173',
                ws: true,
            },
            '/formula-api': {
                target: 'http://localhost:5173',
                changeOrigin: true,
            },
            '/tiles': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/tiles/, ''),
            },
        }
    }
})
