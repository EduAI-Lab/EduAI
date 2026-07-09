import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  server: {
    port: 3001,
    allowedHosts: true,
  },
  plugins: [tsconfigPaths(), tailwindcss(), reactRouter()],
  resolve: {
    dedupe: ['react-router', 'react', 'react-dom'],
  },
});
