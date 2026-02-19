# Preview Bridge Bootstrap (Cross-Origin)

This guide is for apps rendered inside the Cozea preview iframe.

When the preview iframe is cross-origin, host-side script injection is blocked by the browser. Live preview still works, but inspector/screenshot need the bridge runtime to be loaded from inside the preview app.

## Quick Setup (Hosted Script)

Add this to your app HTML shell (for example `index.html`, `_document.tsx`, or framework equivalent):

```html
<script src="https://YOUR_GATEWAY_DOMAIN/preview/bridge/bootstrap.js"></script>
```

At runtime, the bootstrap script reads:

- `cozeaBridgeScript` from the iframe URL query string
- optional fallback `window.__COZEA_BRIDGE_SCRIPT_URL__`

If found, it injects that runtime script once.

## Quick Setup (TypeScript Utility)

You can also use the shared helper at (copy it into your preview app repo, or mirror the same logic):

- `shared/previewBridgeBootstrap.ts`

Example:

```ts
import { bootstrapPreviewBridge } from './previewBridgeBootstrap'

bootstrapPreviewBridge()
```

Call it once near app startup.

## Expected Query Params

The host should provide:

- `cozeaBridgeScript`: absolute URL to the bridge runtime (example: `https://gateway/preview/bridge/client.js`)
- `cozeaBridgeOrigin`: origin allowed to receive bridge postMessage events

## Notes

- If the bootstrap cannot load the runtime, preview rendering is unaffected.
- Inspector and screenshot controls remain unavailable until the runtime posts `bridge:ready`.
