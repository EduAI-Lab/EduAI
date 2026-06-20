import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const frontendDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(frontendDir, '../..')
const monorepoRoot = path.resolve(frontendDir, '../../../..')

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
    server: {
      port: 5173,
      host: '0.0.0.0',
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
  }
})
