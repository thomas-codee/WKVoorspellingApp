import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/WKVoorspellingApp/', // 👈 Dit zorgt ervoor dat GitHub Pages de bestanden kan vinden
  server: {
    port: 4173,
  },
});