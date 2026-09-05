import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import { build as viteBuild, type Alias, type Plugin } from 'vite'

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

// Shared default for the collab worker, which serves both the AI proxy and the
// device gateway (/auth/device/*, /devapps/runtime-builds). The device gateway
// used to fall back to https://api.cozea.app, which has no DNS record, so an
// unset VITE_AUTH_SERVER_URL failed a DevApp publish minutes in with
// "Could not reach the DevApp builder at https://api.cozea.app".
const DEFAULT_COZEA_WORKER_ORIGIN = 'https://cozea-collab.kelyan-engone.workers.dev'

function resolveAiProxyTarget(): string {
  const defaultRemoteTarget = DEFAULT_COZEA_WORKER_ORIGIN

  // Optional explicit proxy target (origin or full URL).
  const configured = process.env.VITE_AI_PROXY_TARGET || process.env.VITE_AI_API_URL

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

function resolveDeviceGatewayOrigin(): string {
  const configured =
    process.env.VITE_AUTH_SERVER_URL || process.env.VITE_COLLAB_BASE_URL || DEFAULT_COZEA_WORKER_ORIGIN
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
      throw new Error('The device gateway must use HTTPS')
    }
    return url.origin
  } catch {
    throw new Error('VITE_AUTH_SERVER_URL must be an HTTPS origin')
  }
}

const aiProxyTarget = resolveAiProxyTarget()
const deviceGatewayOrigin = resolveDeviceGatewayOrigin()
const reactCompilerEnabled = readBooleanFlag('VITE_FF_REACT_COMPILER', true)
const rolldownBuildEnabled = readBooleanFlag('VITE_FF_ROLLDOWN_BUILD', true)
const repoRoot = path.resolve(__dirname, '../..')
const t3Root = path.resolve(repoRoot, 'vendor/t3code')
const t3DesktopSource = path.resolve(t3Root, 'apps/desktop/src')
const sharedAliases: Alias[] = [
  { find: '@', replacement: path.resolve(__dirname, './src') },
  { find: '@shared', replacement: path.resolve(repoRoot, './shared') },
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
    replacement: `${path.resolve(repoRoot, './shared/assistant-contracts')}/$1`,
  },
  {
    find: '@cozea/assistant-contracts',
    replacement: path.resolve(repoRoot, './shared/assistant-contracts/index.ts'),
  },
  {
    find: /^@cozea\/assistant-shared\/(.*)$/,
    replacement: `${path.resolve(repoRoot, './shared/assistant-shared')}/$1`,
  },
  {
    find: '@cozea/assistant-shared',
    replacement: path.resolve(repoRoot, './shared/assistant-shared/index.ts'),
  },
  {
    find: /^@cozea\/effect-acp\/(.*)$/,
    replacement: `${path.resolve(repoRoot, './packages/effect-acp/src')}/$1`,
  },
  {
    find: '@cozea/effect-acp',
    replacement: path.resolve(repoRoot, './packages/effect-acp/src/client.ts'),
  },
  {
    find: /^@cozea\/contracts\/(.*)$/,
    replacement: `${path.resolve(repoRoot, './packages/contracts/src')}/$1`,
  },
  {
    find: '@cozea/contracts',
    replacement: path.resolve(repoRoot, './packages/contracts/src/index.ts'),
  },
  {
    find: /^@cozea\/client-runtime\/(.*)$/,
    replacement: `${path.resolve(repoRoot, './packages/client-runtime/src')}/$1`,
  },
  {
    find: '@cozea/client-runtime',
    replacement: path.resolve(repoRoot, './packages/client-runtime/src/index.ts'),
  },
  {
    find: '@t3tools/contracts',
    replacement: path.resolve(t3Root, 'packages/contracts/src/index.ts'),
  },
  {
    find: /^@t3tools\/shared\/(.*)$/,
    replacement: `${path.resolve(t3Root, 'packages/shared/src')}/$1.ts`,
  },
]

interface SandboxedPreloadBundle {
  entry: string
  fileName: string
}

const sandboxedPreloadBundles: SandboxedPreloadBundle[] = [
  {
    entry: path.resolve(t3DesktopSource, 'preview-pick-preload.ts'),
    fileName: 'preview-pick-preload.cjs',
  },
  {
    entry: path.resolve(__dirname, 'electron/preloads/devAppPreviewPickPreload.ts'),
    fileName: 'devapp-preview-pick-preload.cjs',
  },
  {
    entry: path.resolve(t3DesktopSource, 'preview-pip-preload.ts'),
    fileName: 'preview-pip-preload.cjs',
  },
]

/**
 * Electron's sandboxed preload loader cannot resolve relative Rollup chunks.
 * Keep the entries in electron-vite's preload graph for watch invalidation,
 * then overwrite each emitted entry with T3's single-entry bundle shape.
 */
function sandboxedPreloadBundlesPlugin(): Plugin {
  return {
    name: 'cozea-sandboxed-preload-bundles',
    async closeBundle() {
      for (const bundle of sandboxedPreloadBundles) {
        await viteBuild({
          configFile: false,
          logLevel: 'warn',
          resolve: {
            alias: sharedAliases,
          },
          build: {
            emptyOutDir: false,
            outDir: path.resolve(__dirname, 'out/preload'),
            target: 'node22',
            lib: {
              entry: bundle.entry,
              formats: ['cjs'],
              fileName: () => bundle.fileName,
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        })
      }
    },
  }
}

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
  if (
    normalizedId.includes('/node_modules/dockview/') ||
    normalizedId.includes('/node_modules/dockview-core/') ||
    normalizedId.includes('/node_modules/dockview-react/')
  ) {
    return 'vendor-workbench-dockview'
  }
  if (normalizedId.includes('/node_modules/@codemirror/') || normalizedId.includes('/node_modules/codemirror/')) {
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
    normalizedId.includes('/node_modules/@hugeicons/') ||
    normalizedId.includes('/node_modules/@react-symbols/')
  ) {
    return 'vendor-ui'
  }
  if (normalizedId.includes('/node_modules/lexical/') || normalizedId.includes('/node_modules/@lexical/')) {
    return 'vendor-editor'
  }

  return undefined
}

export default defineConfig({
  main: {
    define: {
      __COZEA_DEVICE_GATEWAY_ORIGIN__: JSON.stringify(deviceGatewayOrigin),
    },
    resolve: {
      alias: sharedAliases,
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
    build: {
      externalizeDeps: {
        exclude: [
          '@pierre/diffs',
          '@cozea/effect-acp',
          '@opencode-ai/sdk',
          '@t3tools/contracts',
          '@t3tools/shared',
          'effect',
          'playwright-core',
          'react-grab',
        ],
      },
      lib: {
        entry: {
          index: 'electron/mainEntry.ts',
          'workbench-runtime': 'electron/workbench-runtime/child.ts',
          'substrate-shadow-server': 'electron/substrate-shadow-server/child.ts',
        },
      },
      rollupOptions: {
        external: ['electron', '@vscode/ripgrep', 'node-pty', 'electron-updater', '@cozea/pty'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: sharedAliases,
    },
    plugins: [sandboxedPreloadBundlesPlugin()],
    build: {
      externalizeDeps: {
        exclude: ['@t3tools/contracts', 'react-grab'],
      },
      lib: {
        entry: {
          index: 'electron/bootstrapPreload.ts',
          'preview-pick-preload': path.resolve(t3DesktopSource, 'preview-pick-preload.ts'),
          'devapp-preview-pick-preload': 'electron/preloads/devAppPreviewPickPreload.ts',
          'preview-pip-preload': path.resolve(t3DesktopSource, 'preview-pip-preload.ts'),
        },
      },
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: (chunk) => (chunk.name === 'index' ? 'index.js' : '[name].cjs'),
        },
      },
    },
  },
  renderer: {
    root: '.',
    envDir: repoRoot,
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
      // @ts-expect-error enableNativePlugin is a rolldown-vite flag absent from the stable vite types.
      enableNativePlugin: rolldownBuildEnabled ? true : false,
    },
    builder: {
      sharedConfigBuild: rolldownBuildEnabled,
      sharedPlugins: rolldownBuildEnabled,
    },
    server: {
      host: 'localhost',
      port: 5183,
      // Swarm / best-of-n worktrees live under `.worktrees/` and must not
      // invalidate the main checkout's Vite optimizer (stale Lexical/dockview
      // prebundles → "Failed to fetch dynamically imported module").
      watch: {
        ignored: ['**/.worktrees/**', '**/.agent/**', '**/node_modules/**'],
      },
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
