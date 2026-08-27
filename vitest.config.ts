import { defineConfig } from 'vitest/config'
import path from 'node:path'

const repoRoot = __dirname
const desktopRoot = path.join(repoRoot, 'apps/desktop')

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(desktopRoot, './src'),
      '@shared': path.resolve(repoRoot, './shared'),
      '@cozea/assistant-contracts': path.resolve(
        repoRoot,
        './shared/assistant-contracts/index.ts',
      ),
      '@cozea/assistant-shared': path.resolve(repoRoot, './shared/assistant-shared'),
      '@cozea/contracts': path.resolve(repoRoot, './packages/contracts/src/index.ts'),
      '@cozea/contracts/t3/rpc': path.resolve(repoRoot, './packages/contracts/src/t3/rpc.ts'),
      '@cozea/contracts/collab': path.resolve(repoRoot, './packages/contracts/src/collab.ts'),
      '@cozea/client-runtime': path.resolve(repoRoot, './packages/client-runtime/src/index.ts'),
      '@cozea/substrate-contracts': path.resolve(
        repoRoot,
        './packages/substrate-contracts/src/index.ts',
      ),
      '@cozea/substrate-client-runtime': path.resolve(
        repoRoot,
        './packages/substrate-client-runtime/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    // Several suites parse the repo with the TS compiler API or spawn child
    // processes (CLI boot, mock ACP agents); under full-suite load or on CI
    // the default 5s limit flakes.
    testTimeout: 20_000,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.test.tsx',
      'tests/**/*.spec.tsx',
    ],
    // `server/` is gitignored and absent from CI checkouts. These suites import
    // modules that only exist when a local server tree is present; keep the
    // files for optional local runs, but do not fail verify on collect errors.
    //
    // `workbenchRuntimeTerminalHost` pulls in `@cozea/pty`, which has no Linux
    // native binary in this repo — CircleCI's Linux executor cannot collect it.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/auth/authCallbackState.test.ts',
      'tests/git/gitRouteAccess.test.ts',
      'tests/providers/googleReasoningCapabilities.test.ts',
      'tests/electron/workbenchRuntimeTerminalHost.test.ts',
    ],
  },
})
