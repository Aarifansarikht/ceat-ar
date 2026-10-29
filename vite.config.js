import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:https` serves over HTTPS with a self-signed certificate so a
// phone on the same Wi-Fi can open the camera (getUserMedia needs a secure
// context; plain http:// only works on localhost).
export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'https' && basicSsl()].filter(Boolean),
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2020',
    // mind-ar bundles TensorFlow.js (~2 MB); it is split into its own chunk.
    chunkSizeWarningLimit: 2600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          mindar: ['mind-ar/dist/mindar-image.prod.js'],
        },
      },
    },
  },
}));
