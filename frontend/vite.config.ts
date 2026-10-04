import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Overridable so a second copy can run next to the usual one.
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8000',
    },
  },
})
