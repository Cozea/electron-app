# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## AI Infrastructure

### Required env vars

Server (Railway/Fastify):
- `CONVEX_URL` - Convex deployment URL.
- `AI_GATEWAY_SECRET` - Shared secret for server-to-Convex access (must match Convex env).
- `AI_DEVTOOLS` - Optional: set to `true` in local dev to enable AI SDK DevTools (never enable in production).
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY` - Fallback org keys if no workspace key is set.
- `REDIS_URL` - Redis backing store for rate limiting.
- `STRIPE_SECRET_KEY` - Stripe API key.
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook verification secret.
- `STRIPE_PRICE_CROSSCODE_PRO`, `STRIPE_PRICE_CROSSCODE_MAX`, `STRIPE_PRICE_CROSSCODE_TEAM` - Optional fallback price IDs if Convex catalog is not set.
- `STRIPE_PRICE_CREDITS_1000`, `STRIPE_PRICE_CREDITS_5000`, `STRIPE_PRICE_CREDITS_15000`, `STRIPE_PRICE_CREDITS_50000` - Optional fallback price IDs for credit packs.
- `ALLOWED_ORIGINS` - Comma-separated CORS allowlist (include `app://` for Electron).

Electron (renderer + main):
- `VITE_AI_API_URL` - AI Gateway chat endpoint (default `http://localhost:3001/ai/chat`).
- `AUTH_SERVER_URL` - Auth gateway base URL for desktop auth.

Convex:
- `CONVEX_ENCRYPTION_KEY` - 32-byte hex key for AES-256-GCM.
- `AI_GATEWAY_SECRET` - Same shared secret used by the server.

### BYOK vs org keys
- Org keys are stored encrypted at rest in Convex using AES-256-GCM and only decrypted in trusted server paths.
- BYOK is per-user and encrypted at rest; org policy can require, allow, or disable BYOK.
- The renderer only receives key presence and policy flags, never raw secrets.

### Credits, overage, and spending caps
- Credits are charged per request using tier rates and are deducted in order: subscription credits -> purchased credits -> overage.
- Overage is only allowed on paid plans when `aiSettings.overageEnabled` is true and under `monthlySpendingCapCents`.
- Usage records include token counts, credits charged, model/provider, tool usage, and timing.

### Local end-to-end test
1) Start Convex: `npm run dev:convex`
2) Start the auth/AI gateway: `cd server && npm run dev`
3) Start the Electron renderer: `npm run dev`
4) Optional: bootstrap Stripe catalog and store in Convex:
   `cd server && npx tsx src/scripts/bootstrap-stripe.ts`

## Releasing the desktop app (GitHub Releases)
1) Bump `package.json` version.
2) Prepare bundled Git runtimes:
   - `npm run prepare:bundled-git` (host target)
   - `npm run prepare:bundled-git:check` (host target validation only)
   - `COZEA_GIT_BUNDLE_REQUIRE=all npm run prepare:bundled-git` (all macOS/Windows targets)
   - `npm run prepare:bundled-git:all` (all macOS/Windows targets)
   - `npm run prepare:bundled-git:check:all` (validate all macOS/Windows targets)
   - `COZEA_GIT_BUNDLE_TARGETS=win32-x64,win32-arm64 npm run prepare:bundled-git` (explicit subset)
   - Configure macOS archive URLs when cross-building non-native macOS bundles:
     - `COZEA_GIT_BUNDLE_URL_DARWIN_ARM64`
     - `COZEA_GIT_BUNDLE_URL_DARWIN_X64`
   - Env values may be remote archive URLs or absolute local archive paths.
   - On native macOS target, missing bundles auto-build from latest `git/git` source.
3) Set release env vars:
   - `GH_TOKEN` (repo scope)
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (mac notarization)
4) Run `npm run release` (publishes installers + update metadata to GitHub Releases).
5) Users receive updates automatically (checks on launch and every 6 hours).

## Dev test for bundled Git runtime
- `npm run dev:bundled-git` runs a bundled-Git preflight check first, then starts dev with bundled-Git lookup forced.
- `npm run prepare:bundled-git:check` validates the required bundle for the current host without launching the app.
- If you see `ERR_CONNECTION_REFUSED` for `localhost`, start the app with `npm run dev` (or `npm run dev:bundled-git`) instead of launching Electron directly.

## CI Release Matrix
- Use `.github/workflows/release-matrix.yml` to build/publish `darwin-arm64`, `darwin-x64`, `win32-x64`, and `win32-arm64`.
- Trigger by tag push (`v*`) or manual workflow dispatch.
- GitHub Actions release secrets:
  - Required for publish: `GH_TOKEN`
  - Required for macOS sign/notarize: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`
  - Optional bundled Git archives (override auto-fetch/build): `COZEA_GIT_BUNDLE_URL_DARWIN_ARM64`, `COZEA_GIT_BUNDLE_URL_DARWIN_X64`, `COZEA_GIT_BUNDLE_URL_WIN32_X64`, `COZEA_GIT_BUNDLE_URL_WIN32_ARM64`

### GitHub Actions release flow
1) Create GitHub repository secrets:
   - `GH_TOKEN` = PAT with repo release write scope.
   - `APPLE_ID` = Apple ID email.
   - `APPLE_APP_SPECIFIC_PASSWORD` = app-specific password.
   - `APPLE_TEAM_ID` = Apple developer team ID.
   - `CSC_KEY_PASSWORD` = password used when exporting your signing `.p12`.
   - `CSC_LINK` = base64-encoded `.p12` contents.
2) Build `CSC_LINK` from local `.p12`:
   - macOS:
     - `base64 -i /absolute/path/Certificates.p12 | tr -d '\n'`
   - Linux:
     - `base64 -w0 /absolute/path/Certificates.p12`
   - Use the full single-line output as the `CSC_LINK` secret.
3) Dry-run matrix build (no publishing):
   - GitHub Actions -> `Desktop Release Matrix` -> `Run workflow` -> `publish=never`.
4) Publish release:
   - Push a version tag, e.g. `git tag v1.2.3 && git push origin v1.2.3`
   - Or run workflow manually with `publish=always`.
5) Verify output:
   - GitHub Release contains DMG/ZIP (mac) + NSIS artifacts (win) and update metadata files.
