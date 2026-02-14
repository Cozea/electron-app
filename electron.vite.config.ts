import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

function resolveAiProxyTarget(): string {
  const defaultRemoteTarget = 'https://crosscode-auth-gateway-production.up.railway.app'

  // Optional explicit proxy target (origin or full URL).
  const configured =
    process.env.VITE_AI_PROXY_TARGET ||
    process.env.VITE_AI_API_URL

  if (!configured) {
    return defaultRemoteTarget
  }

  // Relative URLs are renderer-side endpoints, not proxy targets.
  if (configured.startsWith('/')) {
    return defaultRemoteTarget
  }

  try {
    return new URL(configured).origin
  } catch {
    return defaultRemoteTarget
  }
}

const aiProxyTarget = resolveAiProxyTarget()

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
      proxy: {
        // Keep AI requests same-origin in dev to avoid browser CORS.
        '/ai': {
          target: aiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    build: {
      rollupOptions: {
        input: 'index.html',
      },
    },
  },
})
