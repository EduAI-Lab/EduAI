import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const frontendDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(frontendDir, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, extensionRoot, '')

  return {
    plugins: [tailwindcss(), react(), tsconfigPaths()],
    resolve: {
      alias: {
        '@': path.resolve(frontendDir, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    envDir: extensionRoot,
    define: {
      'process.env': env,
    },
    test: {
      clearMocks: true,
      environment: 'node',
      setupFiles: ['./src/tests/vitest.setup.ts'],
      include: ['src/tests/integration/**/*.test.ts', 'src/tests/integration/**/*.test.tsx'],
      passWithNoTests: true,
    },
  }
})
