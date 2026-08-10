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
    // Import the flat icon barrel directly. The package root re-exports every
    // icon through nested barrels, which Vite dev must crawl and transform on
    // the first navigation that touches an icon — the main cause of the
    // multi-second-per-page cold start locally. The `.mjs` barrel is a single
    // pre-flattened module.
    alias: {
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
    dedupe: ['react-router', 'react', 'react-dom'],
  },
  // Pre-bundle the hot dependencies at server startup so Vite never has to
  // discover and transform them lazily during a first client-side navigation
  // (the "10s to open each page" symptom). Without this, each new route pays
  // the esbuild pre-bundle cost on demand — worst on Windows. The heavy deps
  // below are pulled transitively through the shared `@eduai/ui` library, so
  // authenticated routes would otherwise transform them one-by-one on first
  // visit.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      '@tabler/icons-react',
      'shiki',
      'marked',
      'react-markdown',
      'react-day-picker',
      'embla-carousel-react',
      'cmdk',
      'vaul',
      'input-otp',
      'sonner',
      'next-themes',
    ],
  },
});
