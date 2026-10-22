import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Optional per-process preview hostname (set PREVIEW_HOST in the environment).
const previewHost = process.env.PREVIEW_HOST;

export default defineConfig({
  // Relative asset URLs: the same build works at a domain root (the Node
  // server), under a GitHub Pages project path, and from a file:// preview.
  base: './',
  plugins: [react()],
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
