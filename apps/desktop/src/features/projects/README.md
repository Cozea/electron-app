# Projects feature

Owns project identity, access, lifecycle, creation/import, project navigation, and project-specific shell presentation.

## Layout

- `contexts/`: project route and synchronization context adapters.
- `hooks/`: project-owned access and lifecycle hooks pending finer extraction.
- `layouts/`: the project shell layout that hosts the sidebar and workbench routes.
- `lib/`: project lifecycle, mutation, route, and local-cleanup rules. Cross-domain files that used to sit here as compatibility facades have been removed.
- `model/`: project dialog and project-header state.
- `pages/`: project route surfaces.
- `ui/`: project creation, lifecycle dialogs, shell chrome, and sidebar navigation.

Assistant, workbench, browser, terminal, source-control, settings, workspace, and DevApp behavior belong to their dedicated feature roots.
