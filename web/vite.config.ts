import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy API calls to the Express service so the browser only ever talks to :5173.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
