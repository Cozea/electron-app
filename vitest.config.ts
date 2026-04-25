import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@cozea/assistant-contracts': path.resolve(
        __dirname,
        './shared/assistant-contracts/index.ts',
      ),
      '@cozea/assistant-shared': path.resolve(__dirname, './shared/assistant-shared'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.test.tsx',
      'tests/**/*.spec.tsx',
    ],
  },
})
