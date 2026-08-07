import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const frontendDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(frontendDir, '../..')
const monorepoRoot = path.resolve(frontendDir, '../../../..')

export default defineConfig({
  plugins: [tailwindcss(), react(), tsconfigPaths()],
  css: {
    devSourcemap: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(frontendDir, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  envDir: extensionRoot,
  envPrefix: 'VITE_',
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Explicit hosts only — avoid `allowedHosts: true` (DNS rebinding risk).
    allowedHosts: ['localhost', '127.0.0.1', 'dev.questionmaker.eduai.ok.ubc.ca'],
    fs: {
      allow: [monorepoRoot],
    },
  },
  test: {
    clearMocks: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/vitest.setup.ts'],
    passWithNoTests: true,
  },
})
