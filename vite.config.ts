import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative asset paths: works on GitHub Pages project URLs (/user/repo/)
  // as well as custom domains and localhost without reconfiguration
  base: './',
  plugins: [react()],
})
