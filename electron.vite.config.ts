import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

function readBooleanFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return fallback
}

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
const reactCompilerEnabled = readBooleanFlag('VITE_FF_REACT_COMPILER', true)
const rolldownBuildEnabled = readBooleanFlag('VITE_FF_ROLLDOWN_BUILD', true)

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: {
          index: 'electron/main.ts',
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
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [
      react({
        babel: reactCompilerEnabled
          ? {
              plugins: [['babel-plugin-react-compiler', {}]],
            }
          : undefined,
      }),
      tailwindcss(),
    ],
    experimental: {
      // Vite 8 beta runs on Rolldown; keep a kill switch for native plugin acceleration.
      enableNativePlugin: rolldownBuildEnabled ? true : false,
    },
    builder: {
      sharedConfigBuild: rolldownBuildEnabled,
      sharedPlugins: rolldownBuildEnabled,
    },
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
