import { defineConfig } from 'vite';

// Optional per-process preview hostname (set PREVIEW_HOST in the environment).
const previewHost = process.env.PREVIEW_HOST;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: previewHost ? [previewHost] : undefined,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
