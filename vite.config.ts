import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vite serves index.html as-is in dev (with the dev-friendly CSP that
// permits 'unsafe-eval' + ws://localhost:* for HMR), but in production
// the bundle ships without Vite. Strip the HMR-only directives so the
// shipped CSP only allows 'self' scripts and connection targets.
const cspProdPlugin = {
  name: 'csp-prod',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, ctx: { bundle?: unknown }) {
      if (!ctx.bundle) return html
      return html
        .replace(/ 'unsafe-eval'/g, '')
        .replace(/ ws:\/\/localhost:\*/g, '')
        .replace(/ http:\/\/localhost:\*/g, '')
    },
  },
}

export default defineConfig({
  plugins: [
    react(),
    cspProdPlugin,
  ],
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
