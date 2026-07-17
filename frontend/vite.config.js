import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                // ADR-016: entry point aislado para el export PDF server-side
                // (Chromium headless navega aquí, ver pdf-export-service/).
                printReport: resolve(__dirname, 'print-report.html'),
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
