import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        ws: true
      }
    },
    // Disable HMR to prevent Zod/eval CSP errors that freeze the browser
    hmr: false
  }
})
