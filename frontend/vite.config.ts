import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In dev the Vite server (npm run dev) proxies everything the backend owns to
// FastAPI, so the SPA is served with hot reload while API calls and the
// session cookie all work same-origin. In production
// FastAPI serves the built bundle itself (app/spa.py).
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    proxy: Object.fromEntries(
      ['/api', '/tools', '/snapshot', '/healthz', '/schema', '/docs'].map((p) => [p, backend]),
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
  },
})
