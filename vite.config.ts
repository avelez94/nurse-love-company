import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// "artifact" mode builds a single self-contained page for the hosted preview
// (see scripts/make-artifact.mjs). Normal builds are a standard static site.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    assetsInlineLimit: mode === 'artifact' ? 100_000_000 : 4096,
  },
}))
