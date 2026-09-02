# Settings feature

Owns settings routes, settings chrome, drawer navigation, external-tool preferences, and settings-domain state.

- `pages/`: account, appearance, organizations, and tooling surfaces.
- `ui/`: settings chrome, drawer, and settings-specific disclosure UI.
- `model/`: drawer state and external browser/editor preferences.

Historical `src/pages/settings`, `src/components/settings`, and `src/stores` modules are compatibility facades. New settings code belongs here.
