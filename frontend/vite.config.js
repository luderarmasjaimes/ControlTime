import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
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
            }
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
            }
        }
    }
})
