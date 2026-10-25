import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Vite app calls the same /api/* endpoints as the source dashboard; the API is the copied backend in ./server, kept as a
// separate service. In development and in `vite preview`, /api is proxied to it (default http://localhost:5180).
const API = process.env.AIF_API_URL || 'http://localhost:5180';
const proxy = { '/api': { target: API, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
});
