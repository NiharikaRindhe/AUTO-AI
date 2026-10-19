import { defineConfig } from 'vite';

const backendTarget = process.env.AUTOAI_BACKEND_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  cacheDir: '.cache/vite',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: backendTarget, ws: true } } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: { '/api': { target: backendTarget, ws: true } } },
});
