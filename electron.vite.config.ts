import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: {
          index: 'electron/main.ts',
          fileOpsWorker: 'electron/workers/fileOpsWorker.ts',
        },
      },
      rollupOptions: {
        external: ['electron', '@vscode/ripgrep', 'node-pty', 'electron-updater'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: 'electron/preload.ts',
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    server: {
      host: 'localhost',
      port: 5183,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        input: 'index.html',
      },
    },
  },
})
