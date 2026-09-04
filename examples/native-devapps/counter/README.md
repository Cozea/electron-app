# Native Counter DevApp

Reference package for the native-first DevApp platform.

It deliberately contains no `index.html`, Vite website entry, iframe, or webview. The manifest maps
the `counter` surface directly to the exported `Counter` React component. Cozea supplies the React
runtime, host context, settings, app storage, theme and lifecycle.

The optional extension entry registers a command through the extension-host contract. It receives
no raw Electron or Node API.

This fixture is initially used to validate the manifest, public SDK and builder contract. A later
runtime slice loads its compiled ESM output into Dockview with generation-based development reload.
