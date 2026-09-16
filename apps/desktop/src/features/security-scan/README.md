# Security scan feature

A first-party, development-tier DevApp that runs an automated security scan of the
project's built app or dev server and surfaces the results in the workbench.

The scan engine is the open-source Strix pentester (Apache-2.0), driven locally inside a
Docker sandbox. The model behind it is either an API-key provider Cozea already holds or a
local model endpoint (Ollama, LM Studio). Subscription/OAuth agent logins are never
eligible: a scan talks a raw model API and is token-heavy, which those sessions cannot
serve, and reusing them would breach the provider's terms.

## Layout

- `model/` — the shared contract re-exported for presentation, severity/status helpers,
  and the sample run that drives the UI until the runner is connected.
- `hooks/useSecurityScan.ts` — renderer state and actions. The seam where live run updates
  and the platform bridge are wired in.
- `ui/` — the tile: setup (target + model + consent), live agent activity, the findings
  dashboard, and report export.

## Status

Slice 1 (this): the DevApp registers, launches as a native workbench tile, and renders the
full dashboard against representative sample state.

Slice 2 (next): the main-process runner (`StrixScanService`) launches Strix in Docker,
streams agent activity and findings over IPC, and renders a run to a PDF. A small
OpenAI-compatible model gateway lets Strix reuse Cozea's key-based connections and local
models without the user re-entering a key.

See `shared/securityScanTypes.ts` for the cross-process contract.
