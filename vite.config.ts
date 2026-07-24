import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { generateCountryPages } from './scripts/build_country_pages'

// Emit the static per-country SEO pages into dist/ as part of `vite build`, so
// the production build command (`bunx vite build` on Cloudflare Workers Builds)
// ships them without any extra step. Only runs on build, not dev.
function countryPagesPlugin(): Plugin {
  return {
    name: 'flag-paths-country-pages',
    apply: 'build',
    closeBundle() {
      generateCountryPages(path.resolve(import.meta.dirname, 'dist'))
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), countryPagesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
