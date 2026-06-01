import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    envDir: resolve(__dirname, '../..'),
    define: {
      'process.env': env,
    },
    test: {
      clearMocks: true,
      environment: 'node',
      setupFiles: ['./src/tests/vitest.setup.ts', './src/tests/integration/api.test.setup.ts'],
      include: ['src/tests/integration/**/*.test.ts', 'src/tests/integration/**/*.test.tsx'],
    },
  }
})