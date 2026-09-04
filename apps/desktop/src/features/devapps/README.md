# DevApps feature

This feature owns DevApp manifests, authoring, publication, installation, the unified DevApps Store, runtime targeting, and development previews.

- `apps/`: built-in DevApp manifests and artwork.
- `components/`: DevApp rows, icons, logos, and authoring presentation.
- `model/`: store sections, preview selection, and project-source runtime targeting.
- `pages/AppStorePage.tsx`: the unified store surface shown inside the persistent project shell.
- `preview/`: development preview runtime state and browser-surface coordination.

The former dedicated store sidebar and seven-category catalog were removed on the upstream 0.2.1 line. Workbench code embeds DevApps through adapters; it does not own DevApp behavior.
