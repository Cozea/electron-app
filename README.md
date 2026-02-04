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
2) Set release env vars:
   - `GH_TOKEN` (repo scope)
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (mac notarization)
3) Run `npm run release` (publishes installers + update metadata to GitHub Releases).
4) Users receive updates automatically (checks on launch and every 6 hours).
