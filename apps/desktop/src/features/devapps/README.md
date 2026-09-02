# DevApps feature

Owns DevApp manifests, authoring, local project identity, publication, organization catalog integration, installation, store navigation, runtime targeting, and preview lifecycle.

- `apps/`: built-in DevApp manifests and artwork.
- `components/`: shared DevApp presentation.
- `model/`: store catalog, preview selection, and project-source runtime targeting.
- `preview/`: project DevApp preview runtime state and browser-surface coordination.
- `ui/`: DevApp-store and authoring presentation.

Workbench code embeds DevApps through adapters. New DevApp behavior belongs here rather than under `features/projects`.
