import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin SPA. API calls are proxied to the Fastify server in dev so the
// browser talks to a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
