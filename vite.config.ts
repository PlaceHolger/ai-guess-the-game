/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * GameEntry fields the client never reads (importer metadata for scripts and
 * tests only). Stripped at build time to shrink the ~1MB game-data bundle.
 * Build-only so dev, preview data checks and vitest still see full entries.
 */
function stripUnusedGameFields(): Plugin {
  return {
    name: 'strip-unused-game-fields',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/games\.(hand|auto|custom)\.ts$/.test(id)) return null
      const out = code
        .replace(/,?\s*"?igdbQuery"?\s*:\s*('[^']*'|"[^"]*")/g, '')
        .replace(/,?\s*"?igdbId"?\s*:\s*\d+/g, '')
        .replace(/,\s*}/g, '}')
      return out === code ? null : { code: out, map: null }
    },
  }
}

export default defineConfig({
  // relative asset paths: works on GitHub Pages project URLs (/user/repo/)
  // as well as custom domains and localhost without reconfiguration
  base: './',
  plugins: [react(), stripUnusedGameFields()],
  build: {
    // public/screenshots is dev-only fallback (1.6GB, 8k+ files): the game
    // runs off CDN remotes, so don't copy it into dist/ on every build.
    // Dev keeps serving the folder; deploy uploads only the app (~1MB).
    copyPublicDir: false,
  },
  test: {
    // agent worktrees live inside the repo root: never collect their tests
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['.kilo/**', 'dist/**'],
  },
})
