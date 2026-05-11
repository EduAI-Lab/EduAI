import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // Load env file from project root (2 levels up from frontend)
  const env = loadEnv(mode, process.cwd() + '/../..', '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    define: {
      // Make environment variables available to the app
      'process.env': env,
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
    test: {
      clearMocks: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/vitest.setup.ts'],
    },
  }
})