import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  server: {
    port: 3001,
    // Explicit hosts only — avoid `allowedHosts: true` (DNS rebinding risk).
    allowedHosts: ['localhost', '127.0.0.1', 'dev.aitutor.eduai.ok.ubc.ca'],
  },
  plugins: [tsconfigPaths(), tailwindcss(), reactRouter()],
  resolve: {
    dedupe: ['react-router', 'react', 'react-dom'],
  },
});
