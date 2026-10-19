import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env['API_URL'] ?? 'http://127.0.0.1:3010',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
