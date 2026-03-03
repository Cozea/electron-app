import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'

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

export default defineConfig({
  main: {
    resolve: {
      alias: {
        // LocalAiRuntimeService imports from ../../server/src/routes/ai/...
        // The server package is not bundled into the Electron main process build.
        // This alias maps those cross-package paths to their actual location so
        // Rollup can resolve and bundle them correctly during the Electron build.
        '../../server/src/routes/ai': path.resolve(__dirname, 'server/src/routes/ai'),
      },
    },
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
      {
        name: 'load-vscode-css-as-string',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          const resolved = await this.resolve(source, importer, options)
          if (!resolved) {
            return undefined
          }

          if (resolved.id.match(/node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/)) {
            return {
              ...resolved,
              id: `${resolved.id}?inline`,
            }
          }

          return undefined
        },
      },
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
      dedupe: ['vscode'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    optimizeDeps: {
      include: [
        '@codingame/monaco-vscode-api',
        '@codingame/monaco-vscode-api/extensions',
        'vscode/localExtensionHost',
      ],
      exclude: [
        '@codingame/monaco-vscode-theme-defaults-default-extension',
        '@codingame/monaco-vscode-typescript-language-features-default-extension',
        '@codingame/monaco-vscode-typescript-basics-default-extension',
        '@codingame/monaco-vscode-javascript-default-extension',
        '@codingame/monaco-vscode-json-default-extension',
        '@codingame/monaco-vscode-css-default-extension',
        '@codingame/monaco-vscode-html-default-extension',
      ],
    },
    build: {
      rollupOptions: {
        input: 'index.html',
      },
    },
  },
})
