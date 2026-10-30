import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// "artifact" mode builds a single self-contained page for the hosted design
// preview (see scripts/make-artifact.mjs). Normal builds are the real store.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'artifact' ? './' : '/',
  server: {
    // The API server runs on 8787 in development (npm run dev starts both).
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    assetsInlineLimit: mode === 'artifact' ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 700,
  },
}))
