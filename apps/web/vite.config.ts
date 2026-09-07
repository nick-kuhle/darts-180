import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@darts-180/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@darts-180/rules': fileURLToPath(
        new URL('../../packages/rules/src/index.ts', import.meta.url),
      ),
      '@darts-180/vision-session': fileURLToPath(
        new URL('../../packages/vision-session/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    // Required for the Arena live-preview proxy. Vercel serves the built static files, not Vite.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
