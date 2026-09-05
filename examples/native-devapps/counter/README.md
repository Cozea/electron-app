# Native Counter DevApp

Reference package for the native-first DevApp platform.

It deliberately contains no `index.html`, Vite website entry, iframe, or webview. The manifest maps
the `counter` surface directly to the exported `Counter` React component. Cozea supplies the React
runtime, host context, settings, app storage, theme and lifecycle.

The optional extension entry registers a command through the extension-host contract. It receives
no raw Electron or Node API.

Validate the package:

```bash
bun run scripts/devapps/native-builder-cli.ts validate examples/native-devapps/counter
```

Build a host-loadable ESM release:

```bash
bun run scripts/devapps/native-builder-cli.ts build examples/native-devapps/counter
```

The compiler externalizes React and the native SDK to the `cozea-native-runtime://` host protocol,
rejects Electron, Node and private Cozea imports, validates app-scoped CSS, and emits `release.json`
and `integrity.json`. The native module loader and Dockview preview are the next runtime slice.
