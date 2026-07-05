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
            '/formula-api/ws': {
                target: 'ws://localhost:18020',
                ws: true,
                rewrite: (path) => path.replace(/^\/formula-api/, '') || '/',
            },
            '/formula-api': {
                target: 'http://localhost:18020',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/formula-api/, '') || '/',
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
            '/formula-api/ws': {
                target: 'ws://localhost:18020',
                ws: true,
                rewrite: (path) => path.replace(/^\/formula-api/, '') || '/',
            },
            '/formula-api': {
                target: 'http://localhost:18020',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/formula-api/, '') || '/',
            },
        }
    }
})
