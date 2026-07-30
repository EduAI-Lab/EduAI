import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const frontendDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(frontendDir, '../..')

export default defineConfig({
  plugins: [tailwindcss(), react(), tsconfigPaths()],
  resolve: {
    alias: {
      '@': path.resolve(frontendDir, './src'),
      '@eduai/ui': path.resolve(frontendDir, '../../../../../packages/ui/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  envDir: extensionRoot,
  envPrefix: 'VITE_',
  test: {
      clearMocks: true,
      environment: 'jsdom',
      setupFiles: ['./src/tests/vitest.setup.ts'],
      include: [
        'src/tests/unit/**/*.test.ts',
        'src/tests/unit/**/*.test.tsx',
        'src/components/**/*.test.ts',
        'src/components/**/*.test.tsx',
      ],
      exclude: ['src/tests/integration/**'],
      passWithNoTests: true,
  },
})
