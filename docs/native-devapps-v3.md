# Native React DevApps (manifest v3)

Status: active development contract

## Product definition

A Cozea DevApp is an installable extension with one identity, release, permission grant, update lifecycle and uninstall lifecycle. Its preferred interface is a React component loaded directly into Cozea's renderer. A full website may be adopted through the `web-app` surface adapter without becoming a separate product category.

Users interact with both through the same Store and workbench host. The platform still records the renderer kind because trusted same-realm React code and isolated web content have different security boundaries.

## Native renderer

A native renderer module:

- is an ESM bundle, not an HTML document;
- shares Cozea's React and JSX runtimes;
- exports a descriptor created with `defineNativeDevApp`;
- exposes named components referenced by surface contributions;
- receives project, command and storage APIs through `useDevAppContext`;
- cannot import Electron, Node built-ins, `react-dom`, or private Cozea modules;
- does not receive raw IPC or filesystem paths.

Example:

```tsx
import { useState } from "react"
import {
  DevAppButton,
  DevAppPanel,
  DevAppToolbar,
  defineNativeDevApp,
  useDevAppContext,
} from "@cozea/devapp-api/native"

function MainSurface() {
  const cozea = useDevAppContext()
  const [count, setCount] = useState<number | null>(null)

  return (
    <DevAppPanel>
      <DevAppToolbar title="Project Inspector" />
      <DevAppButton
        onClick={() => void cozea.project.listFiles().then((files) => setCount(files.length))}
      >
        {count === null ? "Inspect project" : `${count} files`}
      </DevAppButton>
    </DevAppPanel>
  )
}

export default defineNativeDevApp({ components: { MainSurface } })
```

## Manifest

```json
{
  "manifestVersion": 3,
  "id": "com.example.project-inspector",
  "name": "Project Inspector",
  "version": "1.0.0",
  "engines": {
    "cozea": ">=0.3.0 <0.4.0",
    "nativeApi": 1
  },
  "rendererModules": {
    "main": {
      "entry": "src/renderer.tsx",
      "output": "dist/renderer.mjs",
      "styles": {
        "entry": "src/styles.css",
        "output": "dist/renderer.css"
      }
    }
  },
  "contributes": {
    "surfaces": [
      {
        "id": "main",
        "title": "Project Inspector",
        "default": true,
        "renderer": {
          "kind": "native-react",
          "module": "main",
          "component": "MainSurface"
        }
      }
    ]
  }
}
```

`rendererModules.*.entry` names authoring source. `output` names the immutable package file loaded by Cozea. A surface references the module and exported component by stable identifiers.

## Building

The `cozea-devapp` executable is distributed by `@cozea/devapp-api`:

```sh
bun run cozea-devapp validate
bun run cozea-devapp build
bun run cozea-devapp dev
```

The builder uses Bun's bundler and replaces React imports with a host-runtime proxy. This guarantees that the extension and Cozea use one React instance. The builder rejects renderer imports of Electron, Node built-ins, `react-dom`, `@/`, `@shared/`, and private Cozea modules.

`dev` watches source files, emits generation-safe ESM, and lets the development tile remount the component. Full React Fast Refresh is deliberately deferred; a deterministic remount is easier to diagnose and preserves host-owned installation/storage state.

## Privileged behavior

A native component runs in Cozea's renderer realm and is therefore trusted UI extension code. It still has no direct Node or Electron access. Privileged and background behavior belongs in an extension worker declared by `extension`:

```json
{
  "extension": {
    "entry": "src/extension.ts",
    "output": "dist/extension.mjs",
    "protocolVersion": 1,
    "capabilities": ["project.read"],
    "tools": []
  }
}
```

Capabilities remain explicit, normalized and approval-bound. Process or terminal spawning is presented as privileged machine access.

## Adopting a website

A website is represented by a `webApplications` entry and a `web-app` surface contribution:

```json
{
  "webApplications": {
    "dashboard": {
      "entry": "web/dist/index.html",
      "dev": {
        "command": "bun run dev:web",
        "url": "http://127.0.0.1:5173"
      }
    }
  },
  "contributes": {
    "surfaces": [
      {
        "id": "dashboard",
        "title": "Dashboard",
        "renderer": {
          "kind": "web-app",
          "application": "dashboard"
        }
      }
    ]
  }
}
```

The same DevApp may contribute a native overview, a native settings component and a web-backed full dashboard. Installation, permissions, services, commands, skills and state belong to the DevApp release, not to an individual renderer.

The existing artifact cache, exact-version installation registry, contained device/hosted runtimes, authenticated loopback service gateway and T3 webview host remain the implementation of this adapter.

## Development session

A DevApp development session may produce several preview targets:

- native React module generations;
- static web application entries;
- loopback web development servers;
- extension workers;
- contained service processes.

The Dev Server should display these as surfaces and processes of one session. A normal website project still uses Browser preview; a native DevApp opens the ESM component host; a hybrid project may expose both simultaneously.

## Installation and uninstall

A release installs as one immutable unit. Native ESM, optional styles, web assets, extension outputs, skills and runtime metadata share an exact release identity and content hash.

Uninstall must:

1. prevent new surface instances;
2. replace restored tiles with an App not installed placeholder;
3. deactivate renderer modules;
4. stop workers/services and revoke leases;
5. unregister commands, skills and settings;
6. remove package bytes;
7. preserve app-owned data unless the user explicitly removes it.

Because browser ESM modules remain cached for the life of a renderer, uninstall deactivates them immediately and may request a Cozea restart to guarantee complete code unloading.

## Agent rules

Scaffolds include an `AGENTS.md` file generated from this contract. Agents must:

- produce exported TSX components rather than `index.html`;
- use `@cozea/devapp-api/native`;
- keep privileged work in the extension module;
- declare every capability and contribution;
- run validation and build before reporting completion;
- prefer native components for new Cozea workflows;
- use `web-app` only to adopt an existing web product or a surface that fundamentally needs a browser document.
