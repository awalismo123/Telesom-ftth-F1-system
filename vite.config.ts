import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Build shape.
 *
 * The app is opened on a phone, often on a weak link, to do one thing: see a
 * route or a dispatch board. Two rules follow from that:
 *
 *  • **Vendor code is cached, app code changes.** Splitting React, Supabase and
 *    the icon set into their own chunks means a deploy only invalidates the
 *    app chunk the technician re-downloads.
 *  • **The OCR engine never loads at login.** `tesseract.js` and its worker are
 *    reached only through a dynamic import inside the ingest wizard, and the
 *    WASM/language assets are copied to `public/tesseract` by
 *    `scripts/vendor-tesseract.mjs` — nothing about them is in the first paint.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    // A single chunk over this size is a sign that a screen was not split.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('@supabase') || id.includes('/postgrest') || id.includes('realtime-js')) {
            return 'supabase';
          }
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'react';
          }
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('tesseract')) return 'ocr';
          return 'vendor';
        },
      },
    },
  },
});
