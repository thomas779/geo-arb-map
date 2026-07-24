import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Emit the static per-country SEO pages into dist/ as part of `vite build`, so
// the production build command (`bunx vite build` on Cloudflare Workers Builds)
// ships them without any extra step. Only runs on build, not dev.
//
// Run as a `bun` subprocess rather than importing the generator: the generator
// pulls in i18n-iso-countries (CommonJS), whose named exports break when Node
// loads vite.config, but work fine under bun at runtime.
function countryPagesPlugin(): Plugin {
  return {
    name: 'flag-paths-country-pages',
    apply: 'build',
    closeBundle() {
      const result = spawnSync('bun', ['scripts/build_country_pages.ts'], {
        cwd: import.meta.dirname,
        stdio: 'inherit',
      })
      if (result.status !== 0) {
        throw new Error('flag-paths-country-pages: generation failed')
      }
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
