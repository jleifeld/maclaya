import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.MACLAYA_DEV_API ?? 'http://127.0.0.1:4545';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': api, '/v1': api } },
});
