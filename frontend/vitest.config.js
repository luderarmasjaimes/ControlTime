import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'src/setupTests.js')],
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
})

