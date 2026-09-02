# DevApps feature

Owns DevApp manifests, authoring, local project identity, publication, organization catalog integration, installation, icons, and preview lifecycle.

- `apps/`: built-in DevApp manifests and artwork.
- `components/`: shared DevApp presentation.
- `preview/`: project DevApp preview runtime state and browser-surface coordination.

Workbench code embeds DevApps through adapters. New DevApp behavior belongs in this feature rather than under `features/projects`.
