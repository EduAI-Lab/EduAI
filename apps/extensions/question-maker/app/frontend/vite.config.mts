import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  css: {
    devSourcemap: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  envDir: resolve(__dirname, '../..'),
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  test: {
    clearMocks: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/vitest.setup.ts'],
    passWithNoTests: true,
  },
})
