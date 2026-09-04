# `@cozea/devapp-api`

Public contracts for Cozea DevApps.

A version-3 DevApp is native-first: its primary interface is a React component rendered directly
inside Cozea. The same application may also expose isolated static or service-backed web surfaces,
an extension-host module, commands, settings, agent skills, and background services.

## Entry points

```ts
import { createDevAppClient, createDevAppWorker } from "@cozea/devapp-api"
import { defineNativeDevApp, useDevAppContext } from "@cozea/devapp-api/native"
import { Button, Panel, PanelToolbar } from "@cozea/devapp-api/ui"
import { defineDevAppExtension } from "@cozea/devapp-api/extension"
import { parseDevAppManifestV3 } from "@cozea/devapp-api/manifest"
```

- The root entry remains the portable view/worker protocol used by contained workers and legacy
  web-backed packages during the platform transition.
- `native` is the renderer ABI. Cozea supplies React, the host context, theme, settings, storage,
  and capability-scoped requests. Native bundles must externalize React and this entry point.
- `ui` is the stable host-component surface. It deliberately exposes a small set rather than
  private Cozea components, so applications do not bind themselves to the repository layout.
- `extension` is the device extension-host ABI. It does not expose Electron or Node directly;
  privileged operations are authorized by Cozea main.
- `manifest` exposes the version-3 authoring/release contracts and fail-closed parser.
- `schema/v3` exposes the generated editor schema.

## Minimal native renderer

```tsx
import { useState } from "react"
import {
  defineNativeDevApp,
  useDevAppContext,
  type NativeDevAppSurfaceProps,
} from "@cozea/devapp-api/native"
import { Button } from "@cozea/devapp-api/ui"

function Counter({ instanceState, setInstanceState }: NativeDevAppSurfaceProps) {
  const host = useDevAppContext()
  const [count, setCount] = useState(0)

  return (
    <Button
      onClick={() => {
        const next = count + 1
        setCount(next)
        setInstanceState({ count: next })
        void host.storage.set("last-count", next)
      }}
    >
      Count: {count}
    </Button>
  )
}

export default defineNativeDevApp({ components: { Counter } })
```

The package contains no `index.html`. Its manifest maps a contributed surface to the `Counter`
component export.

## Trust boundary

Native renderer modules share Cozea's renderer realm. They are trusted extension code, even though
normal privileged operations still require declared capabilities and host authorization. Do not
load unreviewed native modules. Web application surfaces remain isolated and use the same DevApp
identity and lifecycle through a different renderer adapter.

See `docs/devapps/native-platform.md` and `examples/native-devapps/counter` in the Cozea repository.
