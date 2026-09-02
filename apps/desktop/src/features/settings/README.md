# Settings feature

Owns personal and project settings routes, settings chrome, sidebar/drawer navigation, external-tool preferences, and settings-domain state.

- `pages/`: account, appearance, organizations, tooling, and project settings surfaces.
- `ui/`: settings chrome, drawer, sidebar, and settings-specific disclosure UI.
- `model/`: drawer state and external browser/editor preferences.

Historical `src/pages/settings`, `src/components/settings`, project-nested settings modules, and `src/stores` files are compatibility facades. New settings code belongs here.
