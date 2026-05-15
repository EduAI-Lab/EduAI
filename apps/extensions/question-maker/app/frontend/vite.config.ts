import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // Load env file from project root (2 levels up from frontend)
  const env = loadEnv(mode, resolve(__dirname, '../..'), '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    // Load VITE_* vars from apps/extensions/question-maker/.env so they appear
    // in import.meta.env (used by api.ts). The loadEnv + define below keeps
    // process.env.* working for legacy code (e.g. process.env.NODE_ENV in App.tsx).
    envDir: resolve(__dirname, '../..'),
    define: {
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
