import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import type { Alias } from 'vite'

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
  const defaultRemoteTarget = 'https://api.cozea.app'

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
const sharedAliases: Alias[] = [
  { find: '@', replacement: path.resolve(__dirname, './src') },
  { find: '@shared', replacement: path.resolve(__dirname, './shared') },
  {
    find: /^@effect\/sql\/(.*)$/,
    replacement: 'effect/unstable/sql/$1',
  },
  {
    find: '@effect/sql',
    replacement: 'effect/unstable/sql',
  },
  {
    find: /^@cozea\/assistant-contracts\/(.*)$/,
    replacement: `${path.resolve(__dirname, './shared/assistant-contracts')}/$1`,
  },
  {
    find: '@cozea/assistant-contracts',
    replacement: path.resolve(__dirname, './shared/assistant-contracts'),
  },
  {
    find: /^@cozea\/assistant-shared\/(.*)$/,
    replacement: `${path.resolve(__dirname, './shared/assistant-shared')}/$1`,
  },
  {
    find: '@cozea/assistant-shared',
    replacement: path.resolve(__dirname, './shared/assistant-shared'),
  },
  {
    find: /^@cozea\/effect-acp\/(.*)$/,
    replacement: `${path.resolve(__dirname, './packages/effect-acp/src')}/$1`,
  },
  {
    find: '@cozea/effect-acp',
    replacement: path.resolve(__dirname, './packages/effect-acp/src/client.ts'),
  },
]

function normalizeModuleId(id: string): string {
  return id.split(path.sep).join('/')
}

function rendererManualChunks(id: string): string | undefined {
  const normalizedId = normalizeModuleId(id)
  if (!normalizedId.includes('/node_modules/')) {
    return undefined
  }

  if (normalizedId.includes('/node_modules/@xterm/')) {
    return 'vendor-terminal'
  }
  if (normalizedId.includes('/node_modules/dockview/')) {
    return 'vendor-workbench-dockview'
  }
  if (
    normalizedId.includes('/node_modules/@codemirror/') ||
    normalizedId.includes('/node_modules/codemirror/')
  ) {
    return 'vendor-codemirror'
  }
  if (
    /\/node_modules\/(?:@tanstack\/react-router|@tanstack\/react-query|@tanstack\/router-core|@tanstack\/history)\//.test(
      normalizedId,
    )
  ) {
    return 'vendor-tanstack'
  }
  if (/\/node_modules\/(?:react|react-dom|react-is|scheduler)\//.test(normalizedId)) {
    return 'vendor-react'
  }
  if (
    normalizedId.includes('/node_modules/@radix-ui/') ||
    normalizedId.includes('/node_modules/@base-ui/') ||
    normalizedId.includes('/node_modules/cmdk/') ||
    normalizedId.includes('/node_modules/framer-motion/') ||
    normalizedId.includes('/node_modules/motion/') ||
    normalizedId.includes('/node_modules/@hugeicons/') ||
    normalizedId.includes('/node_modules/@react-symbols/')
  ) {
    return 'vendor-ui'
  }
  if (
    normalizedId.includes('/node_modules/lexical/') ||
    normalizedId.includes('/node_modules/@lexical/')
  ) {
    return 'vendor-editor'
  }

  return undefined
}

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAliases,
    },
    build: {
      externalizeDeps: {
        exclude: ['@pierre/diffs', '@cozea/effect-acp', '@opencode-ai/sdk'],
      },
      lib: {
        entry: {
          index: 'electron/main.ts',
          'workbench-runtime': 'electron/workbench-runtime/child.ts',
        },
      },
      rollupOptions: {
        external: ['electron', '@vscode/ripgrep', 'node-pty', 'electron-updater'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
      plugins: [
        {
          name: 'copy-oauth-callback-logo',
          closeBundle() {
            const src = path.join(__dirname, 'src', 'assets', 'logos', 'logo_dark_mode.png')
            const outDir = path.join(__dirname, 'out', 'assets')
            const dest = path.join(outDir, 'logo_dark_mode.png')
            if (fs.existsSync(src)) {
              fs.mkdirSync(outDir, { recursive: true })
              fs.copyFileSync(src, dest)
            }
          },
        },
      ],
    },
  },
  preload: {
    resolve: {
      alias: sharedAliases,
    },
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
      headers: {
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
      proxy: {
        // Keep AI requests same-origin in dev to avoid browser CORS.
        '/ai': {
          target: aiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: sharedAliases,
    },
    worker: {
      // Required for worker URL imports when renderer build outputs multiple chunks.
      format: 'es',
    },
    build: {
      emptyOutDir: true,
      // DevApp PNGs are kept small so they inline as data URLs (no separate asset requests in packaged Electron).
      assetsInlineLimit: 12_288,
      rollupOptions: {
        input: 'index.html',
        output: {
          manualChunks: rendererManualChunks,
        },
      },
    },
  },
})
