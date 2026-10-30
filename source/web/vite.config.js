import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev server sits behind the gateway, so the browser reaches it on 8080.
    hmr: { clientPort: 8080 },
    allowedHosts: true,
  },
});
